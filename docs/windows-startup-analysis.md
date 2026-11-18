# Windows 启动链路与诊断

## 启动顺序

main 默认进入 runGUI → 数据目录 → store.Open → 迁移和索引 → 默认数据 → Token → 插件管理器 → HTTP/MCP → wails.Run → DOM Ready → React → 工作区元数据、列表及当前笔记 → 首次可交互。

新增 internal/startup 记录 startup.data_dir、database.open/migrate/indexes/fts/seed、token、plugins、http、wails、dom_ready。Stage 是阶段耗时，Mark 是进程内累计时间，嵌套阶段不能相加。wails 标记在调用阻塞式 wails.Run 前写入，不将整个应用生命周期计为启动时间；WebView 创建尚无独立精确指标。

## 数据库

之前每次正常打开都会执行 FTS integrity-check。现在正常路径仅确认 schema、索引和触发器存在；新建、版本迁移及缺失 FTS 表仍按需重建，不跳过迁移。WAL、foreign_keys、busy_timeout、连接池策略保持原样。

完整检查独立到 check-db。repair-indexes 先 VACUUM INTO 获取包含已提交 WAL 的一致性备份，再在事务内重建物化列、FTS 和触发器。现有 FTS 损坏不会在每次启动自动扫描发现；出现 267 或搜索异常时关闭所有写入进程并显式检查/修复。

## 前端

- frontend.entry/react.mount/app.ready/workspace.start/workspace.data/first.interactive 使用 performance.now、mark 和 measure。
- 数据与初始或深链笔记加载完成后才标记 interactive；加载失败不误报成功。
- 统计延后到工作区可交互之后；列表及当前笔记仍优先加载。
- 历史窗口、插件管理首次打开才加载；插件激活生命周期保持原逻辑。
- Mermaid 原本已动态 import，继续按需加载；新增加载失败后重试，普通 Markdown 不等待图表。

## 日志

默认 ~/.locknote-mcp/startup.log，每次 GUI/serve 启动覆盖上次文件。前端只接受固定阶段名、有限非负时间并去重，不写 Token 或正文。Go 与前端时间原点不同，不能直接相减；外部 Windows 测试另外测量启动到 interactive 的墙钟时间。多个实例共用数据目录会覆盖日志，诊断时只运行一个 GUI。

本次没有 Windows WebView2 启动数据，不能断言 FTS 是唯一卡顿根因。
