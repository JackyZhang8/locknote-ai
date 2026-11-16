# 笔记检查开发示例

在仓库根目录执行：

```bash
go run ./tools/plugin-pack -dir examples/plugins/note-checker -out dist/plugins
```

在桌面应用“设置 → 插件”安装并启用。点击“检查”或使用 `⌘/Ctrl + Alt + L` 打开底部面板；命令列表还提供主工作区视图和清理行尾空格。

示例展示：底部/主工作区视图、Worker 资源、菜单、工具栏、状态项、按笔记版本更新、确认框及清理。检查最多 500,000 字符、展示最多 200 项；检查器找出行尾空格与 TODO/FIXME，不修改笔记。

格式整理需要用户确认，因为 Markdown 行尾双空格可能代表硬换行。未保存编辑会拒绝更新，版本冲突不会覆盖。Worker 不可用时执行有长度限制的本地检查。详见仓库 `docs/plugin-development.md`。

界面随应用中英文切换，字典位于 manifest.json。示例使用 ctx.i18n、titleKey/textKey 和 language:change，无需重新启用。

左侧菜单只显示“笔记检查”一个入口；主工作区报告保留在插件命令中，不单独占用菜单按钮。
