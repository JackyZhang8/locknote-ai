/* LockNote.ai — language + appearance.
 *
 * The dictionary is keyed by the Chinese source text so app.js can keep its
 * literals readable: tr('全部笔记') returns 'All Notes' in English mode and
 * the original string in Chinese mode. Unknown keys fall back to a longest-
 * first phrase replacement, which also covers HTML fragments built at runtime.
 */
(function () {
  'use strict';

  var DICT = {
    '插件': 'Plugins',
    '恢复前对比': 'Compare before restoring',
    '历史标题：': 'Historical title: ',
    '当前标题：': 'Current title: ',
    '历史字数：': 'Historical word count: ',
    '当前字数：': 'Current word count: ',
    '历史版本': 'Historical version',
    '当前版本': 'Current version',
    '变化行：': 'Changed lines: ',
    '确认恢复此版本': 'Confirm restore',
    '对比／恢复': 'Compare / Restore',
    '撤销': 'Undo',
    '重复笔记': 'Duplicate notes',

    '正在导入…': 'Importing…',
    '跳过': 'Skipped',
    '失败': 'Failed',
    '选择 Markdown 或 ZIP 文件；本软件导出的文件会从末尾标记还原标题、分类和标签，无标记则按普通 Markdown 导入。': 'Choose Markdown or ZIP files. Locknote restores titles, notebooks, and tags from its metadata footer; files without it are imported as ordinary Markdown.',
    '导出为 Markdown 压缩包（.zip），每篇文件末尾附带分类和标签标记；支持直接导入 ZIP 或单篇 Markdown。': 'Export a Markdown ZIP with notebook and tag metadata at the end of each file. Import the ZIP directly or individual Markdown files.',

    '＋ 标签': '+ Tags',
    '设置笔记标签': 'Manage note tags',
    '搜索或新建标签': 'Search or create a tag',
    '移除标签': 'Remove tag',
    '创建标签：': 'Create tag: ',
    '暂无标签，输入名称即可创建。': 'No tags yet. Type a name to create one.',
    '点击选择标签，输入新名称后按 Enter 创建。': 'Click to select tags. Type a new name and press Enter to create it.',

    /* progress: boot / lazy loading / export ---------------------------- */
    '正在打开笔记库': 'Opening your notebook',
    '正在初始化…': 'Initializing…',
    '正在读取偏好设置…': 'Loading preferences…',
    '正在连接本地服务…': 'Connecting to the local service…',
    '正在加载分类与标签…': 'Loading notebooks and tags…',
    '分类与标签已就绪': 'Notebooks and tags ready',
    '笔记已加载': 'Notes loaded',
    '正在整理统计…': 'Finishing up…',
    '就绪': 'Ready',
    '正在加载更多笔记…': 'Loading more notes…',
    '已加载 {0} / {1} 篇 · 向下滚动或点击继续加载': 'Loaded {0} / {1} · scroll or click to load more',
    '已全部加载 · {0} 篇': 'All {0} notes loaded',
    '显示更多 · 已显示 {0} / {1}': 'Show more · {0} / {1} shown',
    '正在导出备份': 'Exporting backup',
    '导出备份': 'Export backup',
    '正在读取笔记并打包…': 'Reading notes and building the archive…',
    '正在生成备份文件…': 'Writing backup file…',
    '正在打包 {0} 篇笔记…': 'Archiving {0} notes…',
    '已用时 {0}s': '{0}s elapsed',
    '打包完成，正在保存…': 'Archive ready, saving…',
    '已导出 {0}': 'Exported {0}',
    '已取消导出': 'Export cancelled',
    '导出失败 {0}': 'Export failed ({0})',
    '导出失败': 'Export failed',

    '更换': 'Replace',
    '重置': 'Reset',
    '令牌已更换，请更新客户端配置': 'Token replaced. Update your client configuration.',
    '全局共用一个访问令牌；更换后旧令牌立即失效，请更新客户端配置。': 'One global access token is shared by all clients. Replacing it invalidates the old token; update your client configuration.',
    '将此配置加入 ~/.codex/config.toml，然后重新连接 Codex。': 'Add this configuration to ~/.codex/config.toml, then reconnect Codex.',
    '确定恢复默认设置吗？外观、语言和编辑器等偏好将重置，笔记和访问令牌不受影响。': 'Restore default settings? Appearance, language, and editor preferences will be reset. Notes and the access token will be preserved.',
    '打开「接入 AI」面板更换全局令牌，或复制端点与客户端配置。': 'Open Connect AI to replace the global token or copy the endpoint and client configuration.',

    '草木绿': 'Leaf green',
    '珊瑚红': 'Coral red',
    '落日橙': 'Sunset orange',
    '雾蓝': 'Misty blue',
    '薰衣草紫': 'Lavender',
    '选择喜欢的界面配色，设置会自动保存。': 'Choose a color palette. Your preference is saved automatically.',
    '导出为 Markdown 压缩包（.zip），含笔记本与标签；解压后的 .md 文件可再次导入。': 'Export a Markdown archive (.zip) with notebooks and tags. Extract the .md files to import them again.',

    /* brand, chrome ---------------------------------------------------- */
    "LockNote.ai · AI 原生笔记库": "LockNote.ai · An AI-native notebook",
    "AI 原生笔记库，让想法有处安放": "An AI-native notebook library, a home for your ideas",
    "MCP 就绪": "MCP ready",
    "MCP 就绪 · ": "MCP ready · ",
    " 个工具": " tools",
    "MCP 未连接": "MCP offline",
    "本地明文存储 · ": "Local plaintext storage · ",
    " 个 MCP 工具": " MCP tools",
    "接入 AI": "Connect AI",
    "应用导航": "App navigation",
    "笔记分类": "Note categories",
    "笔记列表": "Note list",
    "编辑器": "Editor",
    "操作菜单": "Actions",
    "我的资料库": "My Library",
    "让想法有处安放": "A place for every thought",
    "本地明文存储 · 无加密 · 通过 MCP 与 AI 协作": "Local plaintext storage · no encryption · collaborate with AI over MCP",
    "⌘ K 搜索 · ⌘ S 保存 · ⌘ N 新建 · Esc 退出专注": "⌘ K Search · ⌘ S Save · ⌘ N New · Esc Exit focus",

    /* navigation / labels ---------------------------------------------- */
    "全部笔记": "All Notes",
    "置顶笔记": "Pinned Notes",
    "未分类": "Uncategorized",
    "最近编辑": "Recently Edited",
    "AI 写入": "AI Written",
    "回收站": "Trash",
    "笔记本": "Notebooks",
    "笔记": "Notes",
    "最近": "Recent",
    "搜索": "Search",
    "接入": "Connect",
    "关于": "About",
    "设置": "Settings",
    "标签": "Tags",
    "新建笔记": "New Note",
    "新建笔记本": "New Notebook",
    "新增标签": "New Tag",
    "移动到…": "Move to…",
    "搜索标题、正文、标签": "Search titles, bodies and tags",
    "搜索笔记": "Search notes",
    "笔记排序": "Sort notes",
    "批量移动": "Batch move",
    "最近更新优先": "Recently updated first",
    "最近创建优先": "Recently created first",
    "按标题排序": "Sort by title",
    "按字数排序": "Sort by word count",
    "多选": "Select",
    "完成": "Done",
    "已选 ": "Selected: ",
    " 篇": " notes",
    " 篇笔记": " notes",
    "恢复": "Restore",
    "删除": "Delete",
    "取消": "Cancel",
    "确定": "OK",
    "保存": "Save",
    "创建": "Create",
    "置顶": "Pin",
    "取消置顶": "Unpin",
    "修改名称": "Rename",
    "彻底删除": "Delete Permanently",
    "永久删除": "Delete Forever",
    "← 返回": "← Back",
    "编辑": "Edit",
    "预览": "Preview",
    "关闭": "Close",
    "复制": "Copy",
    "吊销": "Revoke",

    /* tooltips / aria --------------------------------------------------- */
    "收起／展开分类导航": "Collapse / expand the sidebar",
    "收起或展开分类导航": "Collapse or expand the sidebar",
    "历史版本": "Version history",
    "专注写作": "Focus mode",
    "标题": "Heading",
    "加粗": "Bold",
    "斜体": "Italic",
    "无序列表": "Bullet list",
    "有序列表": "Numbered list",
    "引用": "Quote",
    "代码块": "Code block",
    "链接": "Link",
    "表格": "Table",
    "分割线": "Divider",
    "置顶／取消置顶": "Pin / unpin",
    "置顶或取消置顶": "Pin or unpin",
    "导出 Markdown": "Export Markdown",
    "移到回收站": "Move to Trash",
    "选择": "Select",
    "右击可置顶、改名或删除": "Right-click to pin, rename or delete",
    "右击可置顶、移动或删除": "Right-click to pin, move or delete",

    /* list / editor ------------------------------------------------------ */
    "未命名笔记": "Untitled Note",
    "未命名": "Untitled",
    "从这里开始写…\n\n支持 Markdown：## 标题、- 列表、**重点**、> 引用、```代码块```": "Start writing here…\n\nMarkdown supported: ## headings, - lists, **bold**, > quotes, ```code blocks```",
    "还没有内容，写下第一个想法吧": "No content yet — write down your first thought",
    " · 最近 30 天": " · Last 30 days",
    " · 匹配「": " · matching “",
    "」": "”",
    "加载中…": "Loading…",
    "没有匹配的笔记<br>试试其他关键词，或切换到全部笔记。": "No matching notes<br>Try another keyword or switch to All Notes.",
    "回收站是空的": "Trash is empty",
    "还没有 AI 写入的笔记<br>在 AI 客户端里让它保存一篇文档试试。": "No AI-written notes yet<br>Ask your AI client to save a document here.",
    "最近 30 天还没有编辑记录": "Nothing edited in the last 30 days",
    "这里还没有笔记<br>点击右上方「新建笔记」开始，或让 AI 写入。": "No notes here yet<br>Click “New Note” above, or let AI write one.",
    "置顶 · ": "Pinned · ",
    "其他笔记": "Other Notes",
    "恢复笔记": "Restore note",
    "回收站内只读": "Read-only in Trash",
    "已保存 · ": "Saved · ",
    "阅读模式": "Reading Mode",
    "编辑模式": "Editing Mode",
    " 字 · ": " chars · ",
    " 字</span>": " chars</span>",
    " 编辑": " edited",
    "未保存…": "Unsaved…",
    "保存中…": "Saving…",
    "保存失败": "Save failed",
    "保存失败：": "Save failed: ",
    "选择一篇笔记，开始阅读或写作。": "Pick a note to read or write.",
    "AI 也可以直接把文档写进这里。": "AI can write documents straight into here, too.",
    "加载失败：": "Load failed: ",

    /* dates -------------------------------------------------------------- */
    "今天 ": "Today ",
    "昨天": "Yesterday",
    " 天前": " days ago",
    "月": "/",
    "日": "",

    /* drawer ------------------------------------------------------------- */
    "把下面这个 MCP 端点填进任意支持 MCP 的客户端，AI 就能读写你的笔记。": "Put this MCP endpoint into any MCP-capable client and the AI can read and write your notes.",
    "接入配置": "Connection",
    "工具": "Tools",
    "令牌": "Tokens",
    "活动": "Activity",
    "MCP 端点（Streamable HTTP）": "MCP endpoint (Streamable HTTP)",
    "访问令牌": "Access token",
    "默认只监听本机，令牌校验开启；把地址换成局域网 IP 即可让同一网络中的设备接入。": "Listens on localhost only with token auth enabled. Use a LAN IP to allow devices on the same network.",
    "令牌以哈希形式保存在本地数据库；可在「令牌」标签页新建或吊销。": "Only token hashes are stored locally. Create or revoke tokens in the Tokens tab.",
    "客户端配置": "Client configuration",
    "它是怎么工作的": "How it works",
    "网页界面和 MCP 服务共用同一个本地 SQLite 数据库。AI 通过 MCP 写入的笔记会立刻出现在左侧列表里": "The web UI and the MCP service share one local SQLite database. Notes written by AI over MCP appear in the list immediately",
    " 标记），": " badge),",
    "你可以在网页里继续编辑，也可以让 AI 追加内容。所有笔记都是纯 Markdown 明文。": "You can keep editing in the app or ask AI to append. Every note is plain Markdown.",
    "资源": "Resources",
    "提示模板": "Prompts",
    "新建令牌": "New token",
    "最近活动": "Recent activity",
    "新建的令牌只在创建时显示一次完整内容，请立即复制。": "A new token is shown in full only once — copy it now.",
    "只读": "Read-only",
    "最近使用 ": "Last used ",
    "从未使用": "Never used",
    "(未生成)": "(not generated)",
    " 个": "",
    "网页": "Web",
    "还没有笔记本": "No notebooks yet",
    "还没有标签，点 ＋ 新建一个": "No tags yet — click + to add one",
    "还没有令牌": "No tokens yet",
    "还没有活动记录": "No activity yet",
    "在终端执行一次即可。之后在 Claude Code 里说「把这份方案存到 Locknote」就会调用它。": "Run this once in a terminal. Then ask Claude Code to “save this plan to Locknote” and it will call the tool.",
    "Claude Desktop 通过本地进程调用（stdio），需要 locknote-mcp 在 PATH 中。配置后重启客户端。": "Claude Desktop launches a local process over stdio, so locknote-mcp must be on your PATH. Restart the client after saving.",
    "写入 Cursor 的 ~/.cursor/mcp.json（或项目内 .cursor/mcp.json），然后在设置里启用。": "Add this to ~/.cursor/mcp.json (or a project-level .cursor/mcp.json), then enable it in Cursor settings.",
    "适用于任何支持 Streamable HTTP 的 MCP 客户端：填入 URL 与 Bearer 令牌即可。": "Works with any MCP client that supports Streamable HTTP: just fill in the URL and the Bearer token.",

    /* activity ----------------------------------------------------------- */
    "创建了笔记": "Created",
    "更新": "Updated",
    "追加": "Appended",
    "移动": "Moved",
    "移入回收站": "Trashed",
    "创建了笔记本": "Created notebook",

    /* toasts / dialogs --------------------------------------------------- */
    "请求失败 ": "Request failed ",
    "已新建笔记": "Note created",
    "请先选择笔记": "Select a note first",
    "请先选择一篇笔记": "Select a note first",
    "已恢复 ": "Restored ",
    "已移到回收站，可前往恢复": "Moved to Trash — you can restore it there",
    "已置顶": "Pinned",
    "已取消置顶": "Unpinned",
    "已置顶 ": "Pinned ",
    "已移动所选笔记": "Moved selected notes",
    "已彻底删除": "Permanently deleted",
    "已吊销令牌": "Token revoked",
    "已复制到剪贴板": "Copied to clipboard",
    "复制失败，请手动选择": "Copy failed — please select manually",
    "已恢复到该版本": "Restored to that version",
    "AI 写入《": "AI wrote “",
    "《": "“",
    "》": "”",
    "已创建令牌：": "Token created: ",
    "名称不能为空": "A name is required",
    "操作失败": "Operation failed",
    "新的小标题": "New heading",
    "重点内容": "Important",
    "强调": "Emphasis",
    "要点": "Point",
    "步骤": "Step",
    "值得记住的一句话": "A thought worth keeping",
    "链接文字": "Link text",
    "| 列一 | 列二 |\\n| --- | --- |\\n| 内容 | 内容 |\\n": "| Column A | Column B |\\n| --- | --- |\\n| Value | Value |\\n",

    /* context menus / forms ---------------------------------------------- */
    "移动到笔记本": "Move to notebook",
    "笔记本名称": "Notebook name",
    "例如：产品设计": "e.g. Product Design",
    "已存在同名笔记本": "A notebook with that name already exists",
    "已创建「": "Created “",
    "标签名称": "Tag name",
    "例如：架构": "e.g. Architecture",
    "标签可以用来给笔记归类；AI 写入时带上同名标签，也会自动归到这一类。": "Tags group notes across notebooks; when AI writes with a matching tag, the note joins that group.",
    "已存在同名标签": "A tag with that name already exists",
    "已新增标签「": "Tag “",
    "已置顶「": "Pinned “",
    "修改笔记本名称": "Rename notebook",
    "修改标签名称": "Rename tag",
    "新名称": "New name",
    "已重命名为「": "Renamed to “",
    "已重命名为 #": "Renamed to #",
    "删除笔记本": "Delete notebook",
    "将删除「": "This will delete “",
    "」。其中的 ": "”. Its ",
    " 篇笔记不会丢失，会变为「未分类」。": " notes will not be lost; they become “Uncategorized”.",
    "已删除笔记本「": "Deleted notebook “",
    "已置顶 #": "Pinned #",
    "改名后，使用这个标签的笔记会继续保留关联。": "Notes using this tag keep their association after renaming.",
    "删除标签": "Delete tag",
    "」会从 ": "” will be removed from ",
    " 篇笔记上移除，笔记本身不会删除。": " notes; the notes themselves stay.",
    "已删除标签「": "Deleted tag “",
    "已移动到「": "Moved to “",
    "删除笔记": "Delete note",
    "「": "“",
    "」会被移到回收站，可以在回收站里恢复。": "” will move to Trash, where you can restore it.",
    "选中的 ": "The selected ",
    " 篇笔记会被移到回收站，可以在回收站里恢复。": " notes will move to Trash, where you can restore them.",
    "」将被永久删除，无法恢复。": "” will be permanently deleted. This cannot be undone.",
    "新建访问令牌": "New access token",
    "用途": "Purpose",
    "AI 客户端": "AI client",
    "例如 Cursor、Claude Code": "e.g. Cursor, Claude Code",
    "关于 LockNote.ai": "About LockNote.ai",
    "历史版本 · ": "Version history · ",
    "<p style=\"margin:0\">还没有历史版本。每次保存或 AI 更新都会留下一个版本。</p>": "<p style=\"margin:0\">No versions yet. Every save or AI update keeps a revision.</p>",

    /* settings dialog ---------------------------------------------------- */
    "偏好设置": "Preferences",
    "通用": "General",
    "数据与备份": "Data & Backup",
    "MCP 与 AI": "MCP & AI",
    "外观": "Appearance",
    "界面语言": "Language",
    "简体中文": "简体中文",
    "English": "English",
    "编辑器默认值": "Editor defaults",
    "默认视图": "Default view",
    "编辑模式": "Editing Mode",
    "阅读模式": "Reading Mode",
    "正文字号": "Body font size",
    "小": "Small",
    "中": "Medium",
    "大": "Large",
    "快捷键": "Shortcuts",
    "搜索": "Search",
    "保存": "Save",
    "新建": "New",
    "退出专注": "Exit focus",
    "数据文件": "Data file",
    "数据以明文 Markdown 存放在本机 SQLite 文件中；复制该文件即为完整备份。": "Notes are stored as plaintext Markdown in a local SQLite file. Copying that file is a complete backup.",
    "复制路径": "Copy path",
    "导出全部笔记": "Export all notes",
    "导出 Markdown": "Export Markdown",
    "导入 Markdown": "Import Markdown",
    "选择一个或多个 .md 文件；支持读取导出文件里的 front matter（标题／笔记本／标签）。": "Pick one or more .md files. Front matter from exported notes (title / notebook / tags) is restored.",
    "选择文件": "Choose files",
    "清空回收站": "Empty Trash",
    "永久删除回收站里的全部笔记，此操作无法撤销。": "Permanently delete every note in Trash. This cannot be undone.",
    "清空": "Empty",
    "连接状态": "Connection status",
    "MCP 端点": "MCP endpoint",
    "协议版本": "Protocol version",
    "访问令牌管理": "Token management",
    "在「接入 AI」里新建、查看和吊销访问令牌。": "Create, review and revoke access tokens in “Connect AI”.",
    "打开接入面板": "Open Connect AI",
    "AI 写入默认笔记本": "Default notebook for AI writes",
    "留空表示未分类；AI 保存文档时若未指定笔记本，会写入这里。": "Leave empty for Uncategorized. When AI saves a document without a notebook, it lands here.",
    "AI 标记": "AI badge",
    "在笔记列表里显示 AI 写入标记": "Show the AI badge in the note list",
    "版本": "Version",
    "产品说明": "Product",
    "设置已保存": "Settings saved",
    "设置保存失败": "Could not save settings",
    "已导出": "Exported",
    "导出失败": "Export failed",
    "已导入 ": "Imported ",
    " 篇笔记": " notes",
    "导入失败": "Import failed",
    "回收站已清空": "Trash emptied",
    "清空失败": "Could not empty Trash",
    "确认清空回收站？": "Empty Trash?",
    "该操作会永久删除回收站中的全部笔记，无法恢复。": "This permanently deletes every note in Trash and cannot be undone.",
    "未选择文件": "No files selected",
    "篇": "notes",
    "个工具": "tools",
    "篇笔记": "notes",
    "项": "items",

    /* settings dialog — second pass -------------------------------------- */
    "偏好设置 · LockNote.ai": "Preferences · LockNote.ai",
    "在此调整外观、语言、数据与 AI 接入行为，设置会保存在本地数据库。": "Adjust appearance, language, data and AI behaviour here. Preferences are stored in the local database.",
    "外观主题": "Theme",
    "界面显示语言，切换后立即生效。": "Interface language. Changes apply immediately.",
    "打开笔记时默认进入编辑或阅读视图。": "Whether a note opens in editing or reading view.",
    "调整正文的阅读字号。": "Adjust the body text size.",
    "自动（AI 笔记用阅读）": "Auto (reading view for AI notes)",
    "小号": "Small",
    "中号": "Medium",
    "大号": "Large",
    "常用快捷键": "Keyboard shortcuts",
    "搜索笔记": "Search notes",
    "新建笔记": "New Note",
    "保存当前笔记": "Save current note",
    "退出专注模式": "Leave focus mode",
    "数据存放位置": "Where your data lives",
    "导出与备份": "Export & backup",
    "导入": "Import",
    "危险操作": "Danger zone",
    "服务": "Service",
    "AI 行为": "AI behaviour",
    "运行中 · 本机监听": "Running · localhost",
    "状态": "Status",
    "打开「接入 AI」面板管理令牌，或复制端点与客户端配置。": "Open “Connect AI” to manage tokens or copy the endpoint and client snippets.",
    "未指定（未分类）": "None (Uncategorized)",
    "在笔记标题旁显示 AI 写入的标记。": "Show a badge next to notes written by AI.",
    "关于本应用": "About this app",
    "关闭设置": "Close settings",
    "回收站中的笔记数量": "Notes in Trash",
    "篇笔记待清空": " notes will be removed",
    "导出成功，文件已开始下载": "Export started",
    "已导入": "Imported",
    "选择 .md 文件": "Choose .md files",
    "重置为默认": "Reset to defaults",
    "设置项已重置": "Preferences reset",
    "开机自启由系统管理": "Launch at login is managed by macOS",
    "纯本地": "Local only",
    "无账号": "No account",
    "无加密": "No encryption",
    "支持 MCP": "MCP ready",
    "读取中…": "Loading…",
    "设置加载失败": "Could not load settings",
    "导入完成": "Import complete",
    " 个文件，跳过 ": " files, skipped ",
    " 个空文件": " empty files",
    "通用 JSON": "Generic JSON",
    "纯本地 · 无账号 · 无加密 · 支持 MCP": "Local only · No account · No encryption · MCP ready",
    "正在清空回收站": "Emptying Trash",
    "正在读取回收站…": "Reading Trash…",
    "正在逐篇永久删除…": "Deleting notes one by one…",
    "已停止": "Stopped",
    "清空回收站失败": "Could not empty Trash",
    "已清理 {0} / {1} 篇": "Removed {0} / {1} notes",
    "已取消 · 已清理 {0} 篇，剩余 {1} 篇仍在回收站": "Cancelled · {0} notes removed, {1} still in Trash",
    "回收站已清空 · 共清理 {0} 篇": "Trash emptied · {0} notes removed",
    "正在逐篇永久删除…（剩余 {0} 篇）": "Deleting one note at a time… ({0} left)",
    "清空失败 {0}": "Could not empty Trash ({0})",
    "每篇笔记单独提交，中途取消不会回滚已删除的部分。": "Each note is committed separately, so cancelling keeps what was already removed."
  };

  // Long static prose that contains inline markup is kept as a whole so the
  // English version can be written naturally instead of phrase-glued.
  var HTML = {
    'empty.editor': {
      'zh-CN': '选择一篇笔记，开始阅读或写作。<br>AI 也可以直接把文档写进这里。',
      'en-US': 'Pick a note to read or write.<br>AI can write documents straight into here, too.'
    },
    'drawer.how': {
      'zh-CN': '网页界面和 MCP 服务共用同一个本地 SQLite 数据库。AI 通过 MCP 写入的笔记会立刻出现在左侧列表里（带 <span class="badge-ai" style="vertical-align:1px"><svg><use href="#i-sparkles"/></svg>AI</span> 标记），你可以在网页里继续编辑，也可以让 AI 追加内容。所有笔记都是纯 Markdown 明文。',
      'en-US': 'The web UI and the MCP service share one local SQLite database. Notes written by AI over MCP appear in the list immediately (with an <span class="badge-ai" style="vertical-align:1px"><svg><use href="#i-sparkles"/></svg>AI</span> badge). You can keep editing here or ask AI to append. Every note is plain Markdown.'
    },
    'foot.shortcuts': {
      'zh-CN': '⌘ K 搜索 · ⌘ S 保存 · ⌘ N 新建 · Esc 退出专注',
      'en-US': '⌘ K Search · ⌘ S Save · ⌘ N New · Esc Exit focus'
    }
  };

  // Composite strings are produced by concatenating literals; handle the few
  // that read badly after fragment translation.
  var PATTERNS = [
    [/^已选 (\d+) 篇笔记$/, 'Selected $1 notes'],
    [/^已选 (\d+) notes$/, 'Selected $1 notes'],
    [/^(\d+) 篇笔记$/, '$1 notes'],
    [/^已恢复 (\d+) 篇笔记$/, 'Restored $1 notes'],
    [/^已置顶 (\d+) 篇$/, 'Pinned $1 notes'],
    [/^AI 写入《(.+)》$/, 'AI wrote “$1”']
  ];

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  var phrases = Object.keys(DICT)
    .filter(function (k) { return /[\u4e00-\u9fff]/.test(k) && k.length > 1; })
    .sort(function (a, b) { return b.length - a.length; });
  var phraseRe = new RegExp(phrases.map(escapeRe).join('|'), 'g');

  var lang = 'zh-CN';

  function tr(s) {
    if (s == null) return '';
    var text = String(s);
    if (lang !== 'en-US' || !text) return text;
    if (Object.prototype.hasOwnProperty.call(DICT, text)) return DICT[text];
    for (var i = 0; i < PATTERNS.length; i++) {
      if (PATTERNS[i][0].test(text)) return text.replace(PATTERNS[i][0], PATTERNS[i][1]);
    }
    if (!/[\u4e00-\u9fff]/.test(text)) return text;
    return text.replace(phraseRe, function (m) { return DICT[m]; });
  }

  function renderHTML(element, markup) {
    window.LNReactUI.renderRegion(element, markup);
  }

  function apply(root) {
    var scope = root || document;
    Array.prototype.forEach.call(scope.querySelectorAll('[data-i18n]'), function (el) {
      el.textContent = tr(el.getAttribute('data-i18n'));
    });
    [['data-i18n-title', 'title'], ['data-i18n-placeholder', 'placeholder'],
      ['data-i18n-aria', 'aria-label']].forEach(function (pair) {
      Array.prototype.forEach.call(scope.querySelectorAll('[' + pair[0] + ']'), function (el) {
        el.setAttribute(pair[1], tr(el.getAttribute(pair[0])));
      });
    });
    Array.prototype.forEach.call(scope.querySelectorAll('[data-i18n-html]'), function (el) {
      var block = HTML[el.getAttribute('data-i18n-html')];
      if (block) renderHTML(el, block[lang] || block['zh-CN']);
    });
    document.title = tr('LockNote.ai · AI 原生笔记库');
  }

  function setLang(next) {
    var wanted = next === 'en-US' ? 'en-US' : 'zh-CN';
    var changed = wanted !== lang;
    lang = wanted;
    document.documentElement.lang = lang;
    apply(document);
    if (changed) window.dispatchEvent(new CustomEvent('ln:language', { detail: { lang: lang } }));
  }

  function setTheme(next) {
    var theme = ['green', 'coral', 'sunset', 'blue', 'lavender'].indexOf(next) >= 0 ? next : 'green';
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-theme-pref', theme);
  }

  function setFontSize(next) {
    var size = ['small', 'medium', 'large'].indexOf(next) >= 0 ? next : 'medium';
    document.documentElement.setAttribute('data-font', size);
  }

  function applyPrefs(prefs) {
    setTheme(prefs.theme);
    setFontSize(prefs.fontSize);
    setLang(prefs.language);
  }

  // The About dialog has long prose; keeping both versions here avoids a
  // fragile phrase-by-phrase translation of HTML.
  function aboutHTML(sys) {
    var v = sys.version || '—';
    var url = sys.mcpUrl || '—';
    var db = sys.dbPath || '—';
    var tools = (sys.tools || []).length;
    var esc = function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    };
    var paras = lang === 'en-US' ? [
      ['A local notebook your AI can read and write.', 'LockNote.ai keeps project docs, ideas and plans in one quiet workspace — and opens it to your AI assistant. What you write and what AI writes land in the same place.'],
      ['Plain Markdown, your data stays yours.', 'Notes are stored as plaintext Markdown in a single local SQLite file. No cloud, no account. Copy that file for a complete backup, migrate it whenever you like, or read it with any tool.'],
      ['MCP built in.', 'The app ships with ' + tools + ' MCP tools plus resources and prompt templates, over Streamable HTTP and stdio. Documents saved by AI appear in the list immediately with an AI badge; your edits are what AI reads next time.'],
      ['Clear access boundaries.', 'The service listens on 127.0.0.1 by default; enable a Bearer token when exposing it beyond localhost. Only token hashes are kept locally. Endpoints, client snippets and token management live in “Connect AI”.']
    ] : [
      ['一个让 AI 直接读写的本地笔记库。', 'LockNote.ai 把项目文档、想法和方案收进一个安静的工作台，同时把它开放给 AI 助手：你写的、AI 写的，落在同一处。'],
      ['纯 Markdown，数据在你自己手里。', '笔记以明文 Markdown 存进本机的一个 SQLite 文件，不依赖云端，也不需要账号；复制这个文件就是完整备份，随时可以迁移，或用任何工具直接读取。'],
      ['内置 MCP 服务。', '应用自带 ' + tools + ' 个 MCP 工具，以及资源和提示模板，支持 Streamable HTTP 与 stdio 两种接入方式。AI 保存的文档会立刻出现在列表里并带 AI 标记；你在界面上的修改，AI 下一次读取时也是最新的。'],
      ['清晰的访问边界。', '服务默认只监听 127.0.0.1；需要对外提供访问时启用 Bearer 令牌，令牌在本地只保存哈希。接入地址、客户端配置示例与令牌管理都收在「接入 AI」里。']
    ];
    var intro = paras[0];
    var html = '<div class="about-intro"><img class="about-logo" src="/icon-about.png" alt="Locknote AI" width="96" height="96">' +
      '<div class="about-intro-copy"><div class="about-product">Locknote AI</div>' +
      '<p><b>' + intro[0] + '</b> ' + intro[1] + '</p></div></div>' + paras.slice(1).map(function (p) {
      return '<p style="margin:0 0 13px"><b style="color:var(--green)">' + p[0] + '</b> ' + p[1] + '</p>';
    }).join('');
    var labels = lang === 'en-US'
      ? ['Version', 'MCP endpoint', 'Data file', 'Shortcuts']
      : ['版本', 'MCP 端点', '数据文件', '快捷键'];
    html += '<div style="border-top:1px solid var(--line);margin-top:16px;padding-top:13px;font-size:11.5px;line-height:2">' +
      '<div>' + labels[0] + ' <span style="color:var(--muted)">·</span> <span style="color:var(--text)">' + esc(v) + '</span></div>' +
      '<div>' + labels[1] + ' <span style="color:var(--muted)">·</span> <span style="color:var(--text)">' + esc(url) + '</span></div>' +
      '<div>' + labels[2] + ' <span style="color:var(--muted)">·</span> <span style="color:var(--text)">' + esc(db) + '</span></div>' +
      '<div>' + labels[3] + ' <span style="color:var(--muted)">·</span> ⌘ K ' + tr('搜索') + ' / ⌘ S ' + tr('保存') + ' / ⌘ N ' + tr('新建') + ' / Esc ' + tr('退出专注') + '</div>' +
      '</div>';
    return html;
  }

  window.LNI18N = {
    tr: tr,
    apply: apply,
    setLang: setLang,
    setTheme: setTheme,
    setFontSize: setFontSize,
    applyPrefs: applyPrefs,
    aboutHTML: aboutHTML,
    get lang() { return lang; },
    get theme() { return theme; }
  };
})();
