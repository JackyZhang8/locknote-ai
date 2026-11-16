# Locknote AI Assistant / AI 助手

A right-side chat plugin for Locknote AI. Requires the host build that provides `ctx.ai.chatCompletion`; the original v0.1.0 host without this API must be rebuilt/updated first.

## 安装与使用

1. 构建当前宿主并重启；本插件新增了宿主 AI 请求接口，旧二进制只导入 ZIP 不够。
2. 打包：`go run ./tools/plugin-pack -dir examples/plugins/ai-assistant -out dist/plugins`。
3. 将 `dist/plugins/dev.locknote.ai-assistant-0.4.4.zip` 拖入「设置 → 插件」，安装并启用。
4. 左侧「AI 助手」或右上角「AI」打开右侧面板，再次点击关闭。也可在「插件命令」中打开。
5. 右上角「配置」填写 API Key；模型旁「获取」拉取列表并选择。「测试」验证当前未保存的配置，再点保存。URL、模型及云端 Key 缺失会提示；本地服务可不填 Key。

## 0.4.4：SDK 稳定性

Provider 设置使用带版本的条件保存；配置冲突时保留输入并提示，不覆盖其他窗口的配置。配合新版宿主修复提交中的笔记写入被插件停用误报为丢弃、分类与置顶参数丢失、改动事件重复广播，以及已打开面板无法激活的问题。先重建宿主，再导入 0.4.4 ZIP。

## 0.4.3：建议稿收起与保留

- 未应用建议稿收起前可选择「应用并收起」「保留建议稿并收起」「继续审阅」；丢弃需确认。
- 保留成功后结束本轮工具操作，不继续执行剩余写入；明确提示尚未保存到笔记。
- 保留的建议稿不随助手面板关闭、插件禁用或重启消失，可从编辑区提示或顶部改动记录继续审阅。再次应用会校验原笔记版本。
- 本机存储失败时不能保留收起；关联空白笔记不会被自动清理。
- 需要重新构建并重启宿主，同时升级插件至 0.4.3，才能获得完整交互和状态提示。

## 0.4.2：恢复与长聊天优化

读取旧聊天失败时仍可创建独立新会话，不会丢弃旧文件；历史分页去重、一次消费游标，加载更早消息保留阅读位置。完整上下文检查点在每轮开始、结束或失败时写入，工具结果和成功回执仍逐条同步落盘。中断恢复收集检查点之后的多页回执，不自动重跑工具。

新版宿主新增可重建的 .idx 文件，每条索引 16 字节，记录 JSONL 偏移、长度及 CRC32；翻页按偏移读取所需记录，不重复扫描全文。索引缺失或校验失败时从 JSONL 重建。会话文件 I/O 使用独立锁，不持有插件管理全局锁；卸载与文件操作通过生命周期锁协调。损坏/丢失的元数据从日志重建，无法修复的会话保留文件并显示警告，正常会话仍可打开。读取旧页不再重复写元数据。

需要重新构建并重启宿主后导入 0.4.2 ZIP，才能获得文件索引和故障隔离优化。已有 JSONL 会话首次读取时自动建立索引。

## 0.4.1：面板与改动提示

「历史」「配置」在助手内部浮层打开，遮住并隔离下方聊天区域，不挤压消息。两者互斥，支持关闭按钮、点击遮层或 Escape 关闭；长列表与配置内容可在浮层内上下滚动。

输入框上方只显示当前笔记最近一条相关改动：待审阅保留，已应用或撤回约 20 秒后隐藏，切换笔记立即隐藏。不删除实际改动记录，仍可从宿主顶部「改动记录」查看。升级已有 0.4.0 宿主只需导入 0.4.1 插件 ZIP；更早宿主仍需先更新会话存储接口。

## 0.4.0：重启恢复聊天

必须先构建并重启新版宿主，再安装 0.4.0 ZIP，旧宿主没有会话文件接口。用户消息先写入本地，再请求模型；助手消息、工具结果及检查点及时追加并同步落盘。存储失败会阻止继续执行并提示，需在「历史」重新打开会话后恢复。卸载默认保留数据，选择删除插件数据才移除聊天。

每个会话的序号用于拒绝并发过期写入。末尾未完成记录会备份后截断，中间损坏保留文件并报错。中断的工具链不会自动恢复执行，修改笔记仍需重新读取、校验和确认。重启保留聊天记录及有限模型上下文，旧轮次按既有预算压缩，不等于每次发送完整聊天。极端情况下，笔记已提交而进程在回执落盘前被强制结束，需核对笔记历史，不能据聊天状态推断写入未发生。

## 当前笔记与多轮对话

默认附带发送时当前笔记的标题、版本及正文前 12,000 字符（包括未保存编辑），可关闭上下文开关。相同快照不重复发送；关闭不会移除历史已发送内容，清空需「新会话」。未保存正文仅供回答，写入仍要求完整读取持久化版本并确认。

保留多轮消息与工具结果；达到预算后将较早完整轮次压缩为本地片段和写入回执，保留最近两轮，并提示可能丢失细节。Provider、模型或 Key 变化会重置模型历史。显示服务商实际输入、输出和缓存命中 token，不保证缓存命中。详细设计见 `docs/ai-assistant-micro-agent.md`。

0.2.0 新增 `ctx.ai.listModels`，须先构建并重启当前宿主，再拖入 ZIP 升级。配置测试不发送笔记，但简短请求可能产生少量费用。

默认 Provider：DeepSeek，Base URL `https://api.deepseek.com`，模型 `deepseek-flash`。模型名可编辑，必须是你的账号/Provider 实际支持的模型；模型不存在时不会擅自切换。自定义服务支持 OpenAI Chat Completions 格式和 function tools，填写 API 根地址（例如 `https://example.com/v1`，不含 `/chat/completions`）。本地模型允许 loopback HTTP，例如 `http://127.0.0.1:11434/v1`。

Enter 发送，Shift+Enter 换行。「停止」取消当前请求或待确认修改；已经确认并保存的修改保留。「新会话」创建独立聊天并保留旧会话。关闭面板会停止运行；应用重启后恢复最近打开的聊天，支持继续对话。右上角「历史」可打开、重命名及确认删除聊天，长聊天可加载更早消息。第一版为逐轮回复，尚非逐 token 流式输出。

## 笔记读取和修改

### 0.3.0：在笔记区审阅建议稿

更新宿主后，AI 新建 / 修改笔记会打开中间笔记区域的审阅面板，右侧保留聊天。可切换「查看差异」「编辑建议稿」「原文」；标题、标签和正文可手动调整。「应用修改」保存当前建议稿，「丢弃」不写入。收起后可从聊天改动卡片或顶部「改动记录」重新打开。旧宿主仅保留原确认界面，升级 ZIP 不会自动升级宿主。

修改应用后可「撤回此次修改」：只有笔记仍为该次应用后的版本、且没有未保存编辑时才恢复原文；有后续编辑会拒绝覆盖。新建笔记不通过撤回删除，可在正常笔记菜单移入回收站。历史记录仍走原有机制。

最多保存 20 份、约 3.5 MB 的本机改动记录，包含笔记快照，按空间清理旧的已结束记录；待审稿不自动应用。草稿编辑约 400ms 后写入 WebView 本地存储，异常退出可能丢失最近尚未落盘的输入。存储失败会提示。聊天自身仍不落盘，插件关闭 / 停止会丢弃当前待确认请求。当前不包含逐块接受、自动三方合并和对待审稿继续调用模型修改。

使用宿主插件 SDK，而非直接数据库或 MCP。可跨分类搜索全部正常笔记、分页列出笔记、分块读取全文、新建及修改笔记。回收站不在默认搜索范围。不会在每次聊天时上传整库；模型通过工具按需选择笔记，相关内容会发送到你配置的 Provider。

每次新建/修改均展示标题、标签及正文前后内容，只有点击「确认保存」才写入。修改必须读取完整正文并使用原版本号；检测未保存编辑、回收站和版本冲突。写入保留宿主历史记录和插件来源，不记为 MCP 活动。第一版不提供删除笔记工具。

每页 40 条，每块 12,000 字符，最多 12 轮工具调用，超大任务分次进行。SDK 现有的每分钟写入限制仍生效。模型输出按纯文本展示，不执行 HTML 或脚本。

## 配置与隐私

Provider 配置保存在 `~/.locknote-mcp/plugins/_data/dev.locknote.ai-assistant.json`，自定义数据目录时随之变化。API Key 是本地明文配置，当前插件系统未提供系统钥匙串；不要分享该文件或将其提交到 Git。聊天、工具结果及有限上下文检查点以明文 JSONL 保存在同目录下的 dev.locknote.ai-assistant/conversations/，每个会话一个文件，附轻量元数据索引；不要分享含敏感笔记的聊天文件。API Key 和鉴权头不进入系统生成的检查点。提供商错误不会透传原始响应体，避免回显凭据或笔记。

## Development / English

`main.js`: bilingual dock chat, history controls and explicit change approval. Journal transport and recovery are in journal.js. `provider.js`: validation, model discovery and tests. `session.js`: current-note snapshots, multi-turn history, bounded compaction and usage. `engine.js`: bounded tool loop and versioned note tools. `styles.css`: scoped theme variables. `manifest.json`: one right-side view; `notes.read`, `notes.write`, `ai.chat`.

The SDK forwards OpenAI-compatible non-streaming requests through the desktop-authenticated backend, avoiding WebView CORS restrictions. Only HTTPS or loopback HTTP providers are accepted; redirects are refused. Requests have a 120-second timeout, a 2 MiB input bound and a 4 MiB response bound. A disabled plugin cannot start requests; disabling/closing aborts frontend work. Capability declarations describe trusted plugin behavior and are not a security sandbox.

Tests: `node --test tests/ai-assistant.cjs`; full frontend suite: `cd frontend && npm test`; backend: `go test ./internal/api -run TestPluginAI`. Tests use simulated provider responses and do not use an API key or incur charges. Test your real provider after configuring your own key.
