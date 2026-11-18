package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"locknote-mcp/internal/api"
	"locknote-mcp/internal/mcp"
	"locknote-mcp/internal/plugins"
	"locknote-mcp/internal/startup"
	"locknote-mcp/internal/store"
)

// desktop 保存 Wails 的运行时上下文，用来把「笔记变了」推给窗口。
type desktop struct {
	mu              sync.RWMutex
	ctx             context.Context
	pluginSession   string
	pluginDirectory string
}

// PluginSession is available through the desktop binding, never the HTTP API.
// It gates trusted plugin management; it is not a sandbox against enabled plugins.
func (d *desktop) PluginSession() string { return d.pluginSession }

// OpenPluginDirectory opens only the configured plugin directory, never a caller-supplied path.
func (d *desktop) OpenPluginDirectory() error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", d.pluginDirectory)
	case "windows":
		cmd = exec.Command("explorer.exe", d.pluginDirectory)
	default:
		cmd = exec.Command("xdg-open", d.pluginDirectory)
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}

func (d *desktop) set(ctx context.Context) {
	d.mu.Lock()
	d.ctx = ctx
	d.mu.Unlock()
}

func (d *desktop) emit(name string, payload any) {
	d.mu.RLock()
	ctx := d.ctx
	d.mu.RUnlock()
	if ctx != nil {
		wruntime.EventsEmit(ctx, name, payload)
	}
}

// runGUI 是默认入口：打开桌面窗口，同时在本地起一个 HTTP 服务，
// 让浏览器和 MCP 客户端连同一个库。
func runGUI(args []string) {
	flags := flag.NewFlagSet("gui", flag.ExitOnError)
	addr := flags.String("addr", envOr("LOCKNOTE_MCP_ADDR", "127.0.0.1:7420"), "MCP / 网页服务监听地址")
	dataDir := flags.String("data", defaultDataDir(), "数据目录")
	safePlugins := flags.Bool("safe-plugins", false, "禁用全部第三方插件后启动")
	_ = flags.Parse(args)

	dir, err := ensureDir(*dataDir)
	if err != nil {
		fatal("创建数据目录失败: %v", err)
	}
	if err := startup.Init(dir); err != nil {
		log.Printf("Startup log unavailable: %v", err)
	}
	defer startup.Close()
	startup.Mark("startup.data_dir")
	st, err := store.Open(filepath.Join(dir, "locknote.db"))
	if err != nil {
		fatal("打开数据库失败: %v", err)
	}
	defer func() { _ = st.Close() }()

	tokenFile := filepath.Join(dir, "token")
	tokenDone := startup.Stage("startup.token")
	defaultToken := ensureToken(st, tokenFile)
	tokenDone()

	baseURL := publicURL(*addr)
	mcpServer := mcp.NewServer(st, version, baseURL)

	webFS, err := fs.Sub(webAssets, "frontend/dist")
	if err != nil {
		fatal("加载界面资源失败: %v", err)
	}

	pluginsDone := startup.Stage("startup.plugins")
	pluginManager, err := plugins.New(filepath.Join(dir, "plugins"), version)
	if err != nil {
		log.Printf("插件管理不可用，主工作区继续启动: %v", err)
	}
	pluginsDone()
	if *safePlugins && pluginManager != nil {
		if err := pluginManager.DisableAll(); err != nil {
			log.Printf("禁用插件失败，跳过插件加载: %v", err)
			pluginManager = nil
		}
	}
	sessionBytes := make([]byte, 32)
	if _, err := rand.Read(sessionBytes); err != nil {
		fatal("创建插件会话失败: %v", err)
	}
	app := &desktop{pluginSession: hex.EncodeToString(sessionBytes), pluginDirectory: filepath.Join(dir, "plugins")}

	apiServer := api.New(api.Config{
		Store:         st,
		Plugins:       pluginManager,
		PluginSession: app.pluginSession,
		OnEvent:       func(event api.Event) { app.emit("locknote:change", event) },
		MCP:           mcpServer,
		WebFS:         webFS,
		Version:       version,
		BaseURL:       baseURL,
		TokenFile:     tokenFile,
		Addr:          *addr,
		RequireToken:  !api.LocalOnly(*addr),
	})

	var closeState desktopCloseState
	handler := apiServer.Handler()

	// All writes share the same SSE and desktop notification path.
	mcpServer.OnChange = apiServer.Broadcast

	// 桌面窗口自己走 Wails 的资源服务 + 进程内 handler；
	// 这个 HTTP 端口是留给浏览器和 MCP 客户端的。
	httpDone := startup.Stage("startup.http")
	if ln, err := net.Listen("tcp", *addr); err == nil {
		srv := &http.Server{Handler: handler, ReadHeaderTimeout: 10 * time.Second}
		go func() { _ = srv.Serve(ln) }()
		printBanner(*addr, baseURL, tokenFile, defaultToken, st.Path(), api.LocalOnly(*addr))
	} else {
		fmt.Fprintf(os.Stderr, "\n  MCP 端点没有启动：%v\n  桌面窗口照常可用，但 AI 客户端暂时连不上。\n\n", err)
	}

	httpDone()
	type bounds struct {
		Width     int
		Height    int
		X         int
		Y         int
		Maximized bool
	}
	savedBounds := bounds{Width: 1280, Height: 860}
	_ = json.Unmarshal([]byte(st.GetSetting("window.bounds", "{}")), &savedBounds)
	if savedBounds.Width < 900 || savedBounds.Width > 7680 {
		savedBounds.Width = 1280
	}
	if savedBounds.Height < 560 || savedBounds.Height > 4320 {
		savedBounds.Height = 860
	}
	startup.Mark("startup.wails")
	err = wails.Run(&options.App{
		Title:            "Locknote",
		Bind:             []interface{}{app},
		Width:            savedBounds.Width,
		Height:           savedBounds.Height,
		MinWidth:         900,
		MinHeight:        560,
		AssetServer:      &assetserver.Options{Assets: webFS, Handler: handler},
		BackgroundColour: &options.RGBA{R: 249, G: 248, B: 242, A: 1},
		OnDomReady: func(ctx context.Context) {
			startup.Mark("startup.dom_ready")
			app.set(ctx)
			if savedBounds.X >= 0 && savedBounds.Y >= 0 && savedBounds.X < 7680 && savedBounds.Y < 4320 {
				wruntime.WindowSetPosition(ctx, savedBounds.X, savedBounds.Y)
			}
			if savedBounds.Maximized {
				wruntime.WindowMaximise(ctx)
			}
			wruntime.EventsOn(ctx, "locknote:frontend-ready", func(...interface{}) {
				closeState.frontendStarted()
			})
			wruntime.EventsOn(ctx, "locknote:close-ready", func(...interface{}) {
				savedBounds.Maximized = wruntime.WindowIsMaximised(ctx)
				if wruntime.WindowIsNormal(ctx) {
					savedBounds.Width, savedBounds.Height = wruntime.WindowGetSize(ctx)
					savedBounds.X, savedBounds.Y = wruntime.WindowGetPosition(ctx)
				}
				if data, err := json.Marshal(savedBounds); err == nil {
					_ = st.SetSetting("window.bounds", string(data))
				}
				closeState.saveFinished()
				wruntime.Quit(ctx)
			})
			setApplicationIcon()
		},
		OnBeforeClose: func(ctx context.Context) bool {
			if closeState.preventClose() {
				wruntime.EventsEmit(ctx, "locknote:before-close")
				return true
			}
			return false
		},
		Mac: &mac.Options{
			TitleBar: mac.TitleBarHiddenInset(),
			About: &mac.AboutInfo{
				Title:   "Locknote",
				Message: "AI 原生笔记库 " + version,
			},
		},
	})
	if err != nil {
		fatal("桌面窗口启动失败: %v", err)
	}
}

// StartupMark accepts only allowlisted phase identifiers, never note text.
func (d *desktop) StartupMark(name string, milliseconds float64) {
	startup.Frontend(name, milliseconds)
}
