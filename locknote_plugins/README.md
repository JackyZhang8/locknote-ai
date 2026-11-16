# Locknote AI 官方插件静态目录

将本目录内容原样上传到 `http://cdn.relaycat.cn/locknote_plugins/`，不要额外嵌套一层 `locknote_plugins/`。

入口：`http://cdn.relaycat.cn/locknote_plugins/plugins.json`。该文件包含全部插件；当前规模不需要服务端分页，客户端下载目录后进行搜索、兼容版本筛选和分页展示。不使用图片预览，不需要数据库或后端 API。

## 文件

| 文件 | 内容 |
| --- | --- |
| `plugins.json` | 市场目录及三个插件的版本、兼容要求、大小、SHA-256 和下载地址 |
| `dev.locknote.ai-assistant-0.4.4.zip` | AI 助手 |
| `dev.locknote.outline-0.1.1.zip` | 笔记大纲 |
| `dev.locknote.note-checker-0.1.1.zip` | 笔记检查 |

ZIP 由仓库 `tools/plugin-pack` 从当前示例源码生成，包含 `manifest.json`、代码、样式、文档与许可证；可直接用于现有 ZIP 安装流程。示例在当前 v0.1.1 宿主下打包，目录中的 `minAppVersion`、`apiVersion`、`capabilities` 原样取自包内清单。

## JSON 约定

- `schemaVersion`：目录结构版本，当前为 1；不等同于应用或插件版本。
- `updatedAt`：目录生成时间，UTC。
- `plugins`：全部插件，按 `id` 与本地安装状态关联，不用名称判断同一插件。
- `name` / `description`：默认展示文案；`locales.zh`、`locales.en` 提供中英文文案，缺失时按 `defaultLocale`、默认文案回退。
- `latestVersion`：插件最新发布版本；客户端仍需从 `releases` 选择最新兼容版本。
- `releases`：已发布版本数组，预留旧版本记录；每项包含 `version`、`minAppVersion`、`apiVersion`、`capabilities`、`file`、`downloadUrl`、`size`（字节）及 ZIP 原始字节的 `sha256`。
- `sourceUrl`：源码入口，不是安装包地址；`license` 表示插件许可证。

版本按语义版本规则比较。下载完成后校验大小、SHA-256，并校验包内插件 ID、版本、兼容要求和能力声明与目录一致，再交给现有安装器。

## 上传与更新

1. 先上传 ZIP，确认下载正常，再上传 `plugins.json`，避免目录指向尚未上传的包。
2. JSON 建议设置 `Content-Type: application/json; charset=utf-8`、`Cache-Control: no-cache`；ZIP 使用 `application/zip`，可长期缓存。
3. 新版本使用新的版本号和 ZIP 文件名，保留旧包；追加版本记录、更新 `latestVersion`、`updatedAt`、大小及哈希，再发布目录。不要覆盖已发布版本的 ZIP。
4. 若改变 CDN 域名或 JSON 所在路径，需更新客户端固定源地址；建议同时更新 `downloadUrl` 以便人工查看。当前使用用户指定的 HTTP 地址；如 CDN 支持 HTTPS，正式接入建议将目录和 ZIP 统一切换为 HTTPS。HTTP 下哈希只能帮助发现损坏，不能防止目录和安装包被同时篡改。
5. 后续客户端由 Go 后端请求目录和下载 ZIP，不依赖浏览器跨域配置；如将来改为网页直接请求，则需要配置 CORS。

客户端已提供「设置 → 插件 → 插件市场」，从本目录读取 JSON，在本地搜索、分页并执行确认后的安装或升级。客户端根据 `file` 相对 JSON 所在目录解析 ZIP 地址，保留 `downloadUrl` 作为发布元数据；跨主机或目录的下载不被允许。
