// Command locknote-mcp is an AI-native Markdown note app with a built-in
// Model Context Protocol server. Notes are stored as plaintext SQLite so that
// agents can read and write them without a human unlocking a vault.
package main

import (
	"context"
	"embed"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"locknote-mcp/internal/api"
	"locknote-mcp/internal/mcp"
	"locknote-mcp/internal/startup"
	"locknote-mcp/internal/store"
)

//go:embed all:frontend/dist
var webAssets embed.FS

//go:embed VERSION
var versionFile string

var version = strings.TrimSpace(versionFile)

func main() {
	log.SetFlags(log.Ltime)
	log.SetPrefix("[locknote] ")

	args := os.Args[1:]
	cmd := ""
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		cmd = args[0]
		args = args[1:]
	}

	switch cmd {
	case "check-db", "repair-indexes":
		runMaintenance(cmd, args)
	case "serve", "web", "run":
		runServe(args)
	case "stdio", "mcp":
		runStdio(args)
	case "token":
		runToken(args)
	case "version", "-v", "--version":
		fmt.Println("locknote-ai " + version)
	case "help", "-h", "--help":
		usage()
	case "":
		// 不带子命令：直接打开桌面应用（Wails 窗口）。
		runGUI(args)
	default:
		fmt.Fprintf(os.Stderr, "未知命令：%s\n\n", cmd)
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Print(`locknote-ai —— 天然适配 AI 的 Markdown 笔记库（内置 MCP 服务）

用法：
  locknote-ai [选项]             打开桌面应用（同时在本机起 HTTP + MCP 服务）
  locknote-ai serve [选项]       只起 HTTP 服务，不开窗口
  locknote-ai stdio [选项]       以 stdio 方式运行 MCP（供 Claude Desktop 等本地客户端调用）
  locknote-ai token [选项]       查看或更换全局 MCP 访问令牌
  locknote-ai version            显示版本
  locknote-ai check-db -data DIR  检查数据库与 FTS（先关闭应用）
  locknote-ai repair-indexes -data DIR  一致性备份后修复索引

通用选项：
  -addr 127.0.0.1:7420   监听地址（默认只监听本机）
  -data ~/.locknote-mcp  数据目录

serve 选项：
  -open                  启动后另外打开浏览器

stdio 选项：
  -data ~/.locknote-mcp  数据目录（与桌面应用共用同一个库）

token 选项：
  -new NAME              更换全局令牌，旧令牌立即失效

示例：
  locknote-ai
  locknote-ai serve -open
  claude mcp add --transport http locknote http://127.0.0.1:7420/mcp --header "Authorization: Bearer <token>"
`)
}

// ---------------------------------------------------------------------------
// serve
// ---------------------------------------------------------------------------

func runServe(args []string) {
	flags := flag.NewFlagSet("serve", flag.ExitOnError)
	addr := flags.String("addr", envOr("LOCKNOTE_MCP_ADDR", "127.0.0.1:7420"), "监听地址")
	dataDir := flags.String("data", defaultDataDir(), "数据目录")
	open := flags.Bool("open", false, "启动后打开浏览器")
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
	defaultToken := ensureToken(st, tokenFile)

	baseURL := publicURL(*addr)
	mcpServer := mcp.NewServer(st, version, baseURL)

	webFS, err := fs.Sub(webAssets, "frontend/dist")
	if err != nil {
		fatal("加载界面资源失败: %v", err)
	}

	apiServer := api.New(api.Config{
		Store:        st,
		MCP:          mcpServer,
		WebFS:        webFS,
		Version:      version,
		BaseURL:      baseURL,
		TokenFile:    tokenFile,
		Addr:         *addr,
		RequireToken: !api.LocalOnly(*addr),
	})
	mcpServer.OnChange = apiServer.Broadcast

	// 先占端口再打印横幅：端口被占用时不要先报一遍「启动成功」。
	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		if isAddrInUse(err) {
			port := *addr
			if _, p, splitErr := net.SplitHostPort(*addr); splitErr == nil {
				port = p
			}
			fmt.Fprintf(os.Stderr, "\n  端口 %s 已被占用，可能已经有一个 locknote-mcp 在运行。\n\n", port)
			fmt.Fprintf(os.Stderr, "  换个端口：  ./dev.sh 前设置 LOCKNOTE_MCP_ADDR=127.0.0.1:7421\n")
			fmt.Fprintf(os.Stderr, "              locknote-ai -addr 127.0.0.1:7421\n")
			fmt.Fprintf(os.Stderr, "  或看看是谁：lsof -nP -iTCP:%s -sTCP:LISTEN\n\n", port)
			os.Exit(1)
		}
		fatal("HTTP 服务启动失败: %v", err)
	}

	printBanner(*addr, baseURL, tokenFile, defaultToken, st.Path(), api.LocalOnly(*addr))

	srv := &http.Server{
		Addr:              *addr,
		Handler:           apiServer.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			fatal("HTTP 服务启动失败: %v", err)
		}
	}()

	if *open {
		go func() {
			time.Sleep(300 * time.Millisecond)
			openBrowser(baseURL)
		}()
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	log.Println("正在关闭…")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}

func printBanner(addr, baseURL, tokenFile, token, dbPath string, local bool) {
	fmt.Printf("\n  LockNote.app %s\n\n", version)
	fmt.Printf("  网页界面   %s\n", baseURL)
	fmt.Printf("  MCP 端点   %s/mcp\n", baseURL)
	if token != "" {
		fmt.Printf("  访问令牌   %s\n", token)
	} else {
		fmt.Printf("  访问令牌   见 %s\n", tokenFile)
	}
	fmt.Printf("  数据文件   %s\n", dbPath)
	fmt.Println()
	fmt.Println("  把上面的 MCP 端点与令牌填进任意 AI 客户端，即可让 AI 读写你的笔记：")
	fmt.Println("    claude mcp add --transport http locknote " + baseURL + "/mcp --header \"Authorization: Bearer <token>\"")
	fmt.Println()
	if !local {
		fmt.Println("  注意：当前监听地址不是本机回环地址，接口已强制要求令牌。")
		fmt.Println()
	}
	fmt.Println("  按 Ctrl+C 退出")
	fmt.Println()
}

// ---------------------------------------------------------------------------
// stdio
// ---------------------------------------------------------------------------

func runStdio(args []string) {
	flags := flag.NewFlagSet("stdio", flag.ExitOnError)
	dataDir := flags.String("data", defaultDataDir(), "数据目录")
	_ = flags.Parse(args)

	dir, err := ensureDir(*dataDir)
	if err != nil {
		fatal("创建数据目录失败: %v", err)
	}
	st, err := store.Open(filepath.Join(dir, "locknote.db"))
	if err != nil {
		fatal("打开数据库失败: %v", err)
	}
	defer func() { _ = st.Close() }()

	server := mcp.NewServer(st, version, "")
	log.Println("MCP stdio 模式已启动")

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if err := server.ServeStdio(ctx); err != nil && err != context.Canceled {
		fatal("stdio 运行结束: %v", err)
	}
}

// ---------------------------------------------------------------------------
// token
// ---------------------------------------------------------------------------

func runToken(args []string) {
	flags := flag.NewFlagSet("token", flag.ExitOnError)
	dataDir := flags.String("data", defaultDataDir(), "数据目录")
	name := flags.String("new", "", "更换全局令牌（兼容旧参数）")
	_ = flags.Parse(args)

	dir, err := ensureDir(*dataDir)
	if err != nil {
		fatal("创建数据目录失败: %v", err)
	}
	st, err := store.Open(filepath.Join(dir, "locknote.db"))
	if err != nil {
		fatal("打开数据库失败: %v", err)
	}
	defer func() { _ = st.Close() }()

	if *name != "" {
		plaintext, err := st.RotateGlobalToken(filepath.Join(dir, "token"))
		if err != nil {
			fatal("创建令牌失败: %v", err)
		}
		fmt.Printf("已更换全局令牌\n%s\n", plaintext)
		return
	}

	tokens, err := st.ListTokens()
	if err != nil {
		fatal("读取令牌失败: %v", err)
	}
	if len(tokens) == 0 {
		fmt.Println("还没有令牌，运行 locknote-mcp token -new 默认 创建。")
		return
	}
	fmt.Println("现有令牌：")
	for _, t := range tokens {
		last := "从未使用"
		if t.LastUsedAt != nil {
			last = t.LastUsedAt.Local().Format("2006-01-02 15:04")
		}
		fmt.Printf("  %s  %s  最近使用: %s\n", t.Prefix, t.Name, last)
	}
	if raw, err := os.ReadFile(filepath.Join(dir, "token")); err == nil {
		fmt.Printf("\n默认令牌（本地界面展示用）：%s\n", strings.TrimSpace(string(raw)))
	}
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func defaultDataDir() string {
	if v := os.Getenv("LOCKNOTE_MCP_HOME"); strings.TrimSpace(v) != "" {
		return v
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ".locknote-mcp"
	}
	return filepath.Join(home, ".locknote-mcp")
}

func ensureDir(dir string) (string, error) {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return "", err
	}
	return abs, nil
}

func ensureToken(st *store.Store, tokenFile string) string {
	token, err := st.EnsureGlobalToken(tokenFile)
	if err != nil {
		fatal("初始化访问令牌失败: %v", err)
	}
	return token
}

func publicURL(addr string) string {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		host, port = addr, "7420"
	}
	switch host {
	case "", "0.0.0.0", "::", "[::]":
		host = "127.0.0.1"
	}
	return fmt.Sprintf("http://%s:%s", host, port)
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		log.Printf("无法自动打开浏览器: %v", err)
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); strings.TrimSpace(v) != "" {
		return v
	}
	return def
}

func isAddrInUse(err error) bool {
	return errors.Is(err, syscall.EADDRINUSE) ||
		strings.Contains(err.Error(), "address already in use")
}

func fatal(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "错误: "+format+"\n", args...)
	os.Exit(1)
}

func runMaintenance(command string, args []string) {
	flags := flag.NewFlagSet(command, flag.ExitOnError)
	dir := flags.String("data", defaultDataDir(), "data directory; close all app processes first")
	_ = flags.Parse(args)
	backup, err := store.MaintainDatabase(filepath.Join(*dir, "locknote.db"), command == "repair-indexes")
	if backup != "" {
		fmt.Println("Backup:", backup)
	}
	if err != nil {
		fatal("Database maintenance failed: %v", err)
	}
	fmt.Println("Database and FTS integrity: OK")
}
