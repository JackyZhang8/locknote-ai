# Locknote AI 插件开发指南

本文对应当前实现的插件 API v1。插件采用受信任的同页面 JavaScript 模型，支持原生 DOM 或自行打包的 React UI。它不是 Obsidian 插件兼容层，也不是恶意代码安全沙箱。

## 安装与管理

桌面应用打开 **设置 → 插件**，将插件 ZIP 拖入该页面，或点击“从文件安装”。安装前查看名称、版本、作者、声明能力和信任提示，确认后安装。默认禁用，可勾选“安装后启用”。普通笔记页面的 ZIP 拖入仍用于笔记导入。

管理页提供启用、禁用、配置、日志、卸载、禁用全部、打开插件目录和安全模式。卸载可选择删除配置，始终保留笔记。更新相同 ID 的插件会保留配置，并重新置为禁用；重新启用意味着信任更新后的代码。

默认目录：

```text
~/.locknote-mcp/plugins/
├── _state.json                  # 安装与启用状态，由宿主管理
├── _data/<plugin-id>.json        # 独立插件配置
└── <plugin-id>/<version>/        # 校验通过的插件文件
```

使用自定义 `-data` 或 `LOCKNOTE_MCP_HOME` 时跟随数据目录。不要手动修改已安装文件；同一版本内容不同会要求明确确认替换；正式发布仍建议递增版本号。

插件管理和代码加载目前仅限桌面端。浏览器不加载第三方插件，MCP 令牌不授予插件安装权限。管理接口使用通过 Wails binding 提供的随机桌面会话，不向普通 REST 客户端公开。此边界不限制已经启用的同页面受信任代码。

### 重复安装、升级与降级

插件以 manifest 的 ID 识别，名称仅用于展示及重名提示：

| 情况 | 处理方式 |
| --- | --- |
| 同 ID、同版本、文件内容相同 | 显示已安装，不重复安装，不改变启用状态 |
| 同 ID、更高版本 | 显示当前与目标版本，确认升级 |
| 同 ID、同版本、内容不同 | 明确提示替换代码，确认后保留配置 |
| 同 ID、更低版本 | 提醒配置可能不兼容，单独勾选理解风险后确认降级 |
| 同名、不同 ID | 提示 ID 和来源差异，作为独立插件安装，不覆盖对方 |

确认框同时显示作者变化、新增声明能力和插件改名。作者字段只是清单文本，不代表签名验证。比较文件内容时忽略 ZIP 条目顺序、压缩参数和时间戳。升级或替换后默认禁用，可显式勾选安装后启用；降级前建议自行备份配置，不承诺旧版能读取新版配置。失败时回滚文件和安装记录。确认到提交之间若已安装内容发生变化，后端返回冲突，需重新选择 ZIP 查看最新状态。

## 运行开发示例

仓库已包含无额外 npm 依赖的示例：

```bash
go run ./tools/plugin-pack -dir examples/plugins/outline -out dist/plugins
go run ./tools/plugin-pack -dir examples/plugins/note-checker -out dist/plugins
go run ./tools/plugin-pack -dir examples/plugins/ai-assistant -out dist/plugins
```

生成：

- `dist/plugins/dev.locknote.outline-0.1.1.zip`：右侧大纲面板，提供单一菜单入口、标题行定位、层级设置和选中笔记变化。
- `dist/plugins/dev.locknote.note-checker-0.1.1.zip`：底部检查面板和主工作区标签页、Worker、行尾空格处理、版本冲突保护。

- `dist/plugins/dev.locknote.ai-assistant-0.4.4.zip`：右侧 AI 聊天、Provider 设置、全库搜索与全文分块读取、确认后版本安全地修改笔记。默认 DeepSeek / deepseek-flash。详见 `examples/plugins/ai-assistant/README.md`。需要重新构建当前宿主以获得 AI 接口。

安装启用后通过顶部工具区的“插件命令”或 `⌘/Ctrl + Shift + P` 查找命令。大纲快捷键是 `Mod+Alt+O`，检查器是 `Mod+Alt+L`。`Mod` 在 macOS 表示 Command，在其他桌面系统表示 Ctrl。

示例只是演示：大纲解析 ATX 标题，不是完整 Markdown AST；检查器最多处理 500,000 字符，最多列出 200 项。清理行尾空格可能改变 Markdown 硬换行，因此需确认。

## 包结构与校验

```text
manifest.json
main.js
styles.css             # 可选
assets/                # 可选，图片、Worker 等
README.md
LICENSE
```

`manifest.json` 推荐放 ZIP 根目录，也接受整体嵌套在单个顶层目录中的包。压缩包最多 16 MiB、解压后最多 32 MiB、最多 512 个 ZIP 条目；插件配置最多 256 KiB。禁止路径穿越、符号链接、绝对路径及跨平台冲突文件名。安装先写临时目录，再切换状态。

```json
{
  "id": "dev.example.outline",
  "name": "Example Outline",
  "version": "0.1.0",
  "apiVersion": 1,
  "minAppVersion": "0.1.0",
  "entry": "main.js",
  "styles": "styles.css",
  "author": "Example",
  "description": "A sidebar example",
  "capabilities": ["ui.sidebar", "notes.readCurrent"],
  "activationEvents": ["onCommand:open"],
  "commands": [{ "id": "open", "title": "Open outline" }]
}
```

插件版本使用不带 `v` 的语义版本。当前支持 API v1，并检查最低应用版本。ID 使用小写字母、数字、点和短横线。`commands` 声明让宿主在插件未执行时展示命令；激活时必须注册相同 ID 的实际实现。

已启用且声明 `ui.sidebar` / `ui.panel` 的插件随工作区激活，恢复左侧菜单、工具栏和设置入口；这不会强制打开面板，面板开关仍按保存的布局恢复。未声明这些 UI 能力时，未提供 activationEvents 或包含 `onStartup` / `onWorkspaceReady` 也会随工作区激活；其余纯命令插件由命令、显式启用或已保存视图触发。安全模式不会自动执行插件代码。第一版没有任意事件表达式解析器。

## 入口与类型声明

入口必须是预构建 ES Module，导出带有 `activate(ctx)` 的默认对象，也支持具名 `activate` / `deactivate`。运行时不安装 npm 依赖。打包时将依赖合并，不依赖裸包名解析或远程模块。

仓库提供 `sdk/plugin-api/index.d.ts`，尚未发布 npm 包：

```bash
# 在独立插件项目中，路径替换为本地仓库绝对路径
npm install --save-dev /absolute/path/to/locknote-ai/sdk/plugin-api
```

```ts
import type { PluginContext } from '@locknote/plugin-api'

export default {
  activate(ctx: PluginContext) {
    ctx.views.register({
      id: 'outline', title: 'Outline', location: 'right',
      mount(container) {
        const title = document.createElement('h3')
        title.textContent = 'Hello from a plugin'
        container.append(title)
        return () => container.replaceChildren()
      },
    })
    ctx.commands.register({
      id: 'open', title: 'Open outline',
      run: () => ctx.workspace.openView('outline'),
    })
  },
}
```

`activate` 可以返回清理函数。所有注册 ID 自动添加 `<plugin-id>:` 命名空间；插件调用 openView 时仍使用自己的短 ID。

## SDK 能力

| 接口 | 主要方法与约定 |
| --- | --- |
| commands | register：注册命令和可选快捷键，返回释放函数 |
| views | register：位置为 left、right、main、bottom |
| workspace | openView、closeView、openNote、revealLine（从 1 开始） |
| toolbar / status | register：注册按钮或可点击状态项 |
| menus | register：context 为 note、editor、notebook |
| settings | register：在插件设置中挂载自定义设置容器 |
| notes | current、get、list、create、update |
| editor | getSelection、replaceSelection、insertText |
| events | on：订阅宿主事件，返回释放函数 |
| storage | get、set：读写整个独立配置对象，不与其他插件合并 |
| ai | chatCompletion：需 ai.chat 声明，桌面宿主转发 OpenAI 兼容请求，支持 signal 取消 |
| ui | notify、confirm：宿主通知与确认框 |
| resources | assetURL：生成包内静态资源地址 |
| timers | setTimeout、setInterval：受生命周期管理的定时器 |
| onDispose | 登记 Worker、监听器等自定义资源清理 |

`notes.readCurrent` 允许读取当前笔记和选区；`notes.read` 扩大为分页查询与按 ID 读取。`notes.updateCurrent` 允许更新当前笔记和插入／替换选区；`notes.write` 允许创建和按 ID 更新。`editor.read`、`editor.write` 分别声明编辑器操作；插入后的笔记保存仍走宿主事务接口。UI 能力如 `ui.sidebar` / `ui.panel` 用于说明用途。能力声明与 SDK 检查是开发约定，不是同页面代码的安全边界。

宿主保留 `Mod+K`、`Mod+S`、`Mod+N`、`Mod+Shift+P`，重复插件快捷键会报告冲突。第一版采用固定的命令快捷键，尚无用户自定义快捷键编辑页。

已安装插件保存在用户数据目录，与仓库中的示例源代码和 dist/plugins 安装包独立。重启应用不会自动升级插件。更新示例后需重新导入新版 ZIP，确认升级并启用；0.1.1 示例的顶部按钮支持面板开关，与左侧菜单同步。

## 配置保存

自定义设置通过 `storage.set` 立即保存整个对象，关闭窗口不会撤销已应用的修改。插件应等待写入完成并提示失败；局部修改时先读取并合并其他字段。

“高级 JSON”与自定义表单分开显示，进入时重新读取配置，点击保存才写入。宿主在锁内校验读取时的 revision；期间配置变化会返回 409 并保留编辑内容，可重新载入后合并重试。JSON 模式的取消仅丢弃该编辑器未保存的文本。

## 多语言

插件跟随应用语言，无需重新启用。manifest 提供 defaultLocale 和 locales 字典，例如 defaultLocale: "en"，locales: { "en": { "name": "Outline", "open": "Open outline", "count": "{count} headings" }, "zh": { "name": "笔记大纲", "open": "打开大纲", "count": "共 {count} 个标题" } }。保留键 name、description 用于插件管理和安装信息。

SDK 提供 ctx.i18n.locale 和 ctx.i18n.t(key, params?, fallback?)，例如 ctx.i18n.t('count', { count: 3 })。逐项按“完整 locale → 语言代码 → defaultLocale 完整代码及语言代码 → fallback 或 key”回退；缺失和空翻译均使用回退。未设置 defaultLocale 时使用 en。翻译作为纯文本，不解析 HTML，不修改用户笔记。

命令、视图、菜单、工具栏、状态栏和设置注册项可附加 titleKey，按钮还可附加 textKey，保留 title/text 作为原始回退。宿主切换语言时自动更新标题，不卸载插件、不关闭面板。manifest.commands 的惰性命令也支持 titleKey；未指定时查找 commands.<id>。

插件管理自己的 DOM，需通过 ctx.events.on('language:change', ({ locale }) => render()) 刷新正文及表单标签，并清理视图专属监听。Worker 返回稳定问题代码，由界面调用 t() 翻译。不要再将语言变化当作 theme:change 处理。两个示例包含完整用法。

视图可设置 showInNavigation: false 隐藏左侧入口，仍可由 openView 或命令打开。笔记检查器只展示一个左侧按钮，其主工作区报告通过插件命令访问。

## 笔记、历史与并发

`notes.current()` 返回编辑器当前内容，可能含有尚未保存的修改，`unsaved` 表明此状态，`version` 表示最近持久化版本。其他读取接口返回数据库快照。`list` 支持现有查询参数，如 scope、q、limit、offset；列表结果默认不含正文，需要时指定 `withBody: 1`，单批最多 500 篇。

```ts
const note = await ctx.notes.current()
if (!note || note.unsaved) {
  ctx.ui.notify('请先保存当前笔记')
  return
}
await ctx.notes.update(note.id, {
  content: (note.content ?? '').trimEnd(),
  expectedVersion: note.version,
})
```

SDK 将创建参数 `NoteCreateInput` 和更新参数 `NoteUpdateInput` 分开；更新的 `expectedVersion` 为必填正整数，运行时也会校验。`PluginNote.version` 必填，`CurrentPluginNote` 额外包含必填的 `content` 和 `unsaved`。当前笔记有未保存编辑、版本过期或已进入回收站时拒绝更新。成功修改进入历史版本与通知流程，来源为 `plugin:<id>`，不会加入 MCP 活动日志。插件笔记也不会计入 AI 写入分类。

编辑器插入／选区替换优先使用系统编辑命令以保留撤销记录，WebView 不支持时退回 textarea 替换；持久化历史仍可恢复，原生撤销行为需要在目标系统验证。插件批量修改需要显式分页、展示确认并处理逐项失败；没有隐式整库事务。

事件包括 `note:selection`、`note:change`、`editor:change`、`editor:selection`、`theme:change`。payload 因事件不同而不同；note:change 可能是 `{note,source,pluginId}`，也可能是后端 `{noteId,version,type,source,...}` 通知，需要正文时重新读取。REST、MCP 和插件修改统一转发到桌面与浏览器。远端变更先刷新宿主笔记再通知插件，编辑中会延后刷新；刷新失败仍发送通知，插件应处理重新读取失败。连续通知可能合并为最新状态，相同笔记、版本、操作及来源的本地／桌面回声会去重。自身 note:change 默认不回传给来源插件；SDK 每个插件每分钟最多接收 60 次写入调用，以中断自动化循环，不应绕过接口实现批量写入。

## 界面、样式与清理

面板开关按钮使用 `ctx.workspace.toggleView(id)`，可与左侧菜单同步打开和关闭。`openView(id)` 始终打开，适用于“打开面板”命令；`closeView(id)` 始终关闭。两个示例的顶部工具栏按钮均使用 toggleView。

命令、菜单和按钮异常会记录日志并传递给界面，命令面板保留打开状态并显示错误。事件与定时器异常只记录日志，避免中断其他插件。不同扩展类型可以复用短 ID，例如命令与视图都叫 outline；注销命令不会卸载同名视图或设置。

宿主管理视图标题、布局、关闭、分栏尺寸和标签切换。mount 接收独立容器，返回清理函数，宿主不会渲染容器内部。关闭视图先释放资源再清空容器。主工作区有“笔记”标签，可以返回原有编辑器。

可以用自己的 React createRoot 渲染容器，但要自行打包 React，并在清理函数中 root.unmount；不要导入宿主内部 React、组件、DOM ID 或 controller 局部实现。

复用 `--ink`、`--muted`、`--green`、`--paper`、`--line`、`--light` 等宿主 CSS 变量，给选择器加插件前缀，不设置全局 body/button 样式。样式作用域不等于安全隔离。

通过 SDK 注册的事件、定时器、视图和命令在禁用时清理。自己创建的 Worker、原生监听器、观察器必须登记 onDispose，视图专属资源还应在 mount 的返回函数里清理。处理异步任务时检查视图是否已销毁，并取消旧请求，避免过期结果覆盖新内容。

## 调试与恢复

使用 `./dev.sh` 在桌面开发环境中调试。修改示例后递增版本，运行打包命令，再从设置导入新版。支持官方静态插件市场，尚无目录热加载或第三方投稿流程。

插件日志保留当前会话最近 200 条，不包含开发者所有 console 输出。加载／初始化超时为 10 秒。异常启动后的下次打开会进入插件安全模式，可先禁用问题插件再恢复；正常退出会清除恢复标记。

界面无法操作时使用命令行：

```bash
# macOS：路径替换为实际安装位置
"/Applications/Locknote AI.app/Contents/MacOS/locknote-ai" -safe-plugins
# Linux
./locknote-ai -safe-plugins
# Windows PowerShell
.\locknote-ai.exe -safe-plugins
```

此选项禁用持久化的全部插件。插件状态损坏时主应用仍继续启动；先退出，再备份 plugins 目录并移走 `_state.json`，恢复后重新安装所需插件。插件管理不影响笔记数据库。

同线程死循环无法被 Promise 超时或 React 错误边界终止。普通命令回调错误会记录，单个加载失败不阻止其他插件；涉及死循环、全局 DOM 污染或原生操作时，仍可能需要强制退出和安全启动。

## 验证命令与范围

```bash
npm --prefix frontend test
npm --prefix frontend run build
go test ./...
go vet ./...
```

自动测试覆盖 ZIP 边界、安装状态、认证、版本冲突、生命周期、视图清理、快捷键和示例注册。真实桌面还需验证拖放、输入法、焦点、Worker、选区撤销、窗口关闭与各系统 WebView 行为。不能用自动化通过代替跨平台实际验收。

## 当前边界

已经提供本地安装管理、四个位置的插件视图、主工作区插件标签、命令、菜单、设置、笔记与编辑器接口，以及三个示例。当前不是完整 Obsidian 工作区克隆：不支持任意拖拽停靠、多个笔记标签页、Markdown 渲染器或 CodeMirror 扩展、第三方市场、自动更新、隔离 iframe、Node.js 原生模块。SDK 声明包尚未公开发布，扩展前应保持 API v1 的兼容性。

项目与示例使用 MIT，第三方插件可使用自己的许可证，需随包保留声明。

## AI Provider 请求

### 宿主笔记改动审阅

新宿主提供 `ctx.changes.review({ before, after, summary? }, { signal? })`（需 `notes.read` 和 `notes.write`），返回 `{ saved, deferred?, cancelled?, changeId, id?, title?, version? }`。修改传完整原笔记及原版本，新建省略 before；它等待用户在宿主差异视图中修改 / 确认，成功后宿主已经写入，插件不能再次调用 notes.update/create。

`ctx.changes.list()` 仅列出该插件的记录，`open(changeId)` 打开审阅，`undo(changeId)` 条件撤回已应用修改。取消 / 禁用清理未保留的待确认操作，已保存内容不回滚。用户明确保留后返回 saved: false、deferred: true 和 changeId：建议稿仍待应用，插件应结束本轮写入，不能宣称已保存或再次创建；保留和恢复的建议稿不随取消 / 禁用而丢弃。恢复记录只在用户操作时重新校验。改动记录在本机 WebView 存储，包含正文快照，最多 20 份及约 3.5 MB；不是云同步或数据库原子日志。发生中断需核对笔记及历史，不自动重试写入。

首期仅整篇应用 / 丢弃及版本一致时撤回；有后续编辑时明确冲突，不自动合并或覆盖。

`ctx.ai.listModels({ baseURL, apiKey? }, { signal? })` 使用 `ai.chat` 能力及桌面会话授权，宿主 GET `/models` 返回去重排序的 `{ models: string[] }`；超时 30 秒、响应最大 1 MiB，支持取消。配置变化后应丢弃旧结果。

聊天支持可选 `maxTokens`（1–32768），转发为 `max_tokens`；响应 `usage` 可包含真实缓存命中数量，不应估算成实际计费结果。AI 助手的上下文、缓存和写入策略见 [微 Agent 设计](ai-assistant-micro-agent.md)。

`ctx.ai.chatCompletion({ baseURL, apiKey?, model, messages, tools? }, { signal? })` 返回 Chat Completions JSON。不包含流式输出。baseURL 是 API 根地址，宿主追加 `/chat/completions`。仅接受 HTTPS 或 loopback HTTP，不跟随重定向；超时 120 秒、请求上限 2 MiB、响应上限 4 MiB。插件禁用会取消 SDK 中的在途请求。宿主不保存、记录请求内的 Key，也不向插件返回提供商原始错误体；插件自行保存 Key 时应解释本地存储方式。声明能力仍不是同页面安全沙箱。


## SDK 加固与迁移（2026-11-16）

保持 API v1 的运行方式，新增 ctx.host.apiVersion、只读 features 和 hasFeature(name)，用于判断接口可用性。能力探测不代替 manifest 的权限声明。TypeScript 检查 NoteQuery 字段及 PluginEventMap 的事件名/载荷，原有 JS 插件仍可运行。

### 配置并发

表单优先 snapshot() 读取 data/revision，保存时 compareAndSet(data, revision)。每个表单保留自己的 revision；CONFIG_CONFLICT 时提示重新载入，不自动用新版本覆盖旧对象。get/set 继续保留，get 记住版本，set 条件写入，成功后更新版本；多个独立表单不要共用该隐式版本。

### 生命周期与笔记

停用阻止后续操作，但已提交且成功的笔记写入/撤回仍返回真实回执，不回滚已提交数据。保存后的列表刷新失败显示提示，不将已保存误报成失败。传输中断且结果不确定时须读取持久状态核对，不能自动重试创建。

审阅支持标题、正文、标签、分类与置顶，界面显示元数据差异，撤回恢复原始分类（含未分类）和置顶。只传分类名称时不会保留旧 ID；同时传两者时 ID 优先。

openView 激活已打开标签，点击标签和返回笔记使用同一宿主选中状态。changes:change 统一订阅广播，不随插件数量放大。

### 错误处理与示例

错误保留 message，并在宿主接口上增加 code/status。优先识别 CONFIG_CONFLICT、INSTALL_CONFLICT、CONVERSATION_CONFLICT、PLUGIN_STOPPED、CAPABILITY_DENIED、RATE_LIMITED；其他 HTTP 错误使用状态映射。插件自身错误不保证有 code，处理 unknown 需先判断。

AI 助手 0.4.4 和大纲 0.1.1 演示条件配置保存；重建宿主后导入新 ZIP。渲染器、网络文件服务、任务系统与第三方市场仍为后续独立建设范围，本次不增加这些 API。

## 官方静态插件市场

「设置 → 插件」提供「已安装」和「插件市场」。官方源固定为 `http://cdn.relaycat.cn/locknote_plugins/plugins.json`，Go 后端使用桌面会话授权代理读取及下载，无需官网后端或浏览器 CORS。客户端获取目录后搜索、按兼容版本选择并以每页 12 项分页，不展示预览图片。

目录使用 schemaVersion 1，最多 1 MiB / 100 个插件，每项最多 100 个发布版本。发布信息参考仓库 `locknote_plugins/plugins.json`。`file` 必须为 `<插件ID>-<版本>.zip`，相对于目录 JSON 的所在路径解析；`downloadUrl` 仅作为发布信息保留，不用于跨域下载。这样移动整个静态目录不必修改每条绝对下载链接。下载限制沿用 16 MiB ZIP 上限。

安装先由 Go 下载到临时文件，核对实际字节数、SHA-256、包内 ID、版本、API、最低应用版本与能力声明。校验后的下载以不透明凭据绑定，15 分钟内确认安装；取消、成功或下次清理过期记录时删除临时文件，启动后清理上次未完成下载。下载最多一个并发，最多保留四个待确认包。提交前再次校验文件，复用 InstallApproved 的本地安装摘要冲突检查及失败回滚。暂不自动升级或启用。

市场目录在数据目录 `plugins/_market/catalog.json` 缓存；进入市场先展示已有缓存；缓存超过十分钟时在后台刷新，期间保留列表并显示更新进度，失败后显示缓存时间与提示。点击刷新会主动重新请求。排队中的目录请求支持取消，不会继续占用下载名额。外部请求不携带桌面会话令牌，重定向仅允许同主机且位于源目录下，可从 HTTP 升级到 HTTPS；跳转链一旦使用 HTTPS，后续禁止降级。当前官方源按部署使用 HTTP，哈希用于完整性检查，不能提供发布者身份认证；切换 HTTPS 需要更新宿主固定源地址。

待审阅且未保留的改动会阻止升级；可先应用、丢弃或明确保留。升级会停止插件，建议先结束进行中的聊天等任务。保留建议稿、插件配置与聊天数据不因代码升级而删除。
