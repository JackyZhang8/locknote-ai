# 大纲侧栏开发示例

在仓库根目录执行：

```bash
go run ./tools/plugin-pack -dir examples/plugins/outline -out dist/plugins
```

将生成的 ZIP 拖入桌面应用“设置 → 插件”，确认安装后启用。点击“大纲”按钮或使用 `⌘/Ctrl + Alt + O` 打开右侧栏，点击标题定位到编辑器对应行。左侧菜单仅保留一个“笔记大纲”入口，点击后在应用右侧打开面板。

示例展示：命令、按需激活、右侧视图、当前编辑缓冲区读取、宿主事件、独立设置、样式变量和视图销毁。通过设置中的插件设置按钮调整标题层级。

仅解析 ATX 标题（`#`），忽略围栏代码中的标题，不是完整 Markdown AST 解析器。开发修改后可重新打包并确认同版本替换；正式发布建议递增 manifest 版本。详见仓库 `docs/plugin-development.md`。

界面随应用中英文切换，字典位于 manifest.json。示例使用 ctx.i18n、titleKey/textKey 和 language:change，无需重新启用。


0.1.1 使用配置快照和条件保存，发生冲突时重新载入并恢复控件，不覆盖其他设置窗口的更新。
