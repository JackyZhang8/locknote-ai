import type { CSSProperties } from 'react'
import { DeferredPluginSettings } from '../plugins/DeferredPluginSettings'

// Keep DOM identifiers and markup stable for the workspace controllers.
export function WorkspaceShell() {
  return (
    <>
      <div className={"shell"}>
        {"\n\n  "}
        {"\n  "}
        <div className={"titlebar-strip"} aria-hidden={"true"} />
        {"\n\n  "}
        <header className={"top"}>
          {"\n    "}
          <div className={"brand"}>
            {"\n      "}
            <img className={"brand-mark"} src={"/icon-64.png"} alt={""} width={"38"} height={"38"} />
            {"\n      "}
            <span className={"name"}>
              {"LockNote.app"}
            </span>
            {"\n      "}
            <span className={"sub"} data-i18n={"AI 原生笔记库，让想法有处安放"}>
              {"AI 原生笔记库，让想法有处安放"}
            </span>
            {"\n    "}
          </div>
          {"\n    "}
          <div className={"top-right"}>
            {"\n      "}
            <span className={"pill"} id={"mcpStatus"}>
              <span className={"dot-live"} />
              <span id={"mcpStatusText"} data-i18n={"MCP 就绪"}>
                {"MCP 就绪"}
              </span>
            </span>
            {"\n      "}
            <button className={"ghost-btn"} id={"connectBtn"}>
              <svg>
                <use href={"#i-plug"} />
              </svg>
              <span data-i18n={"接入 AI"}>
                {"接入 AI"}
              </span>
            </button>
            {"\n    "}
          </div>
          {"\n  "}
        </header>
        {"\n\n  "}
        <div className={"workspace"} id={"workspace"}>
          {"\n\n    "}
          <nav className={"rail"} data-i18n-aria={"应用导航"} aria-label={"应用导航"}>
            {"\n      "}
            <button className={"active"} id={"notesNav"} data-rail={"notes"}>
              <svg>
                <use href={"#i-note"} />
              </svg>
              <span data-i18n={"笔记"}>
                {"笔记"}
              </span>
            </button>
            {"\n      "}
            <button id={"recentNav"} data-rail={"recent"}>
              <svg>
                <use href={"#i-clock"} />
              </svg>
              <span data-i18n={"最近"}>
                {"最近"}
              </span>
            </button>
            {"\n      "}
            <button id={"searchNav"} data-rail={"search"}>
              <svg>
                <use href={"#i-search"} />
              </svg>
              <span data-i18n={"搜索"}>
                {"搜索"}
              </span>
            </button>
            {"\n      "}
            <button id={"aiNav"} data-rail={"ai"}>
              <svg>
                <use href={"#i-sparkles"} />
              </svg>
              <span data-i18n={"AI 写入"}>
                {"AI 写入"}
              </span>
            </button>
            {"\n      "}
            <div className={"bottom"}>
              {"\n        "}
              <button id={"settingsNav"} data-rail={"settings"}>
                <svg>
                  <use href={"#i-settings"} />
                </svg>
                <span data-i18n={"设置"}>
                  {"设置"}
                </span>
              </button>
              {"\n        "}
              <button id={"aboutNav"} data-rail={"about"}>
                <svg>
                  <use href={"#i-info"} />
                </svg>
                <span data-i18n={"关于"}>
                  {"关于"}
                </span>
              </button>
              {"\n      "}
            </div>
            {"\n    "}
          </nav>
          {"\n\n    "}
          <aside className={"library"} data-i18n-aria={"笔记分类"} aria-label={"笔记分类"}>
            {"\n      "}
            <div className={"libtitle"} data-i18n={"我的资料库"}>
              {"我的资料库"}
            </div>
            {"\n      "}
            <div id={"smartNav"} />
            {"\n      "}
            <div className={"section"}>
              <span data-i18n={"笔记本"}>
                {"笔记本"}
              </span>
              {" "}
              <button id={"newFolder"} data-i18n-aria={"新建笔记本"} data-i18n-title={"新建笔记本"} aria-label={"新建笔记本"} title={"新建笔记本"}>
                {"＋"}
              </button>
            </div>
            {"\n      "}
            <div id={"folders"} />
            {"\n      "}
            <div className={"section"}>
              <span data-i18n={"标签"}>
                {"标签"}
              </span>
              {" "}
              <button id={"newTag"} data-i18n-aria={"新增标签"} data-i18n-title={"新增标签"} aria-label={"新增标签"} title={"新增标签"}>
                {"＋"}
              </button>
            </div>
            {"\n      "}
            <div id={"tags"} />
            {"\n      "}
            <div className={"trash"}>
              <button className={"navrow"} data-scope={"trash"}>
                <svg>
                  <use href={"#i-trash"} />
                </svg>
                <span data-i18n={"回收站"}>
                  {"回收站"}
                </span>
                <span className={"count"} id={"trashCount"}>
                  {"0"}
                </span>
              </button>
            </div>
            {"\n    "}
          </aside>
          {"\n\n    "}
          <section className={"list"} data-i18n-aria={"笔记列表"} aria-label={"笔记列表"}>
            {"\n      "}
            <div className={"listhead"}>
              {"\n        "}
              <div className={"titlebar"}>
                {"\n          "}
                <h1 id={"listTitle"} data-i18n={"全部笔记"}>
                  {"全部笔记"}
                </h1>
                {"\n          "}
                <button className={"primary"} id={"newNote"}>
                  <svg>
                    <use href={"#i-plus"} />
                  </svg>
                  <span data-i18n={"新建笔记"}>
                    {"新建笔记"}
                  </span>
                </button>
                {"\n        "}
              </div>
              {"\n        "}
              <p className={"sub"} id={"listSubtitle"} />
              {"\n        "}
              <label className={"search"}>
                {"\n          "}
                <svg>
                  <use href={"#i-search"} />
                </svg>
                {"\n          "}
                <input id={"search"} data-i18n-placeholder={"搜索标题、正文、标签"} data-i18n-aria={"搜索笔记"} placeholder={"搜索标题、正文、标签"} aria-label={"搜索笔记"} />
                {"\n          "}
                <span className={"key"}>
                  {"⌘ K"}
                </span>
                {"\n        "}
              </label>
              {"\n      "}
            </div>
            {"\n      "}
            <div className={"listtools"}>
              {"\n        "}
              <select id={"sort"} data-i18n-aria={"笔记排序"} aria-label={"笔记排序"}>
                {"\n          "}
                <option value={"updated"} data-i18n={"最近更新优先"}>
                  {"最近更新优先"}
                </option>
                {"\n          "}
                <option value={"created"} data-i18n={"最近创建优先"}>
                  {"最近创建优先"}
                </option>
                {"\n          "}
                <option value={"title"} data-i18n={"按标题排序"}>
                  {"按标题排序"}
                </option>
                {"\n          "}
                <option value={"words"} data-i18n={"按字数排序"}>
                  {"按字数排序"}
                </option>
                {"\n        "}
              </select>
              {"\n        "}
              <button id={"batchToggle"} data-i18n={"多选"}>
                {"多选"}
              </button>
              {"\n      "}
            </div>
            {"\n      "}
            <div className={"batch hidden"} id={"batch"}>
              {"\n        "}
              <span id={"selectionCount"}>
                {"已选 0 篇"}
              </span>
              {"\n        "}
              <select id={"batchMove"} data-i18n-aria={"批量移动"} aria-label={"批量移动"}>
                <option value={""} data-i18n={"移动到…"}>
                  {"移动到…"}
                </option>
              </select>
              {"\n        "}
              <button id={"batchPin"} data-i18n={"置顶"}>
                {"置顶"}
              </button>
              {"\n        "}
              <button id={"batchDelete"} data-i18n={"删除"}>
                {"删除"}
              </button>
              {"\n        "}
              <button id={"cancelBatch"} data-i18n={"取消"}>
                {"取消"}
              </button>
              {"\n      "}
            </div>
            {"\n      "}
            <div className={"rows"} id={"rows"} />
            {"\n    "}
          </section>
          {"\n\n    "}
          <main className={"editor"} data-i18n-aria={"编辑器"} aria-label={"编辑器"}>
            {"\n      "}
            <header className={"edithead"}>
              {"\n        "}
              <div className={"breadcrumbs"}>
                {"\n          "}
                <button className={"iconbtn"} id={"toggleLibrary"} data-i18n-title={"收起／展开分类导航"} data-i18n-aria={"收起或展开分类导航"} title={"收起／展开分类导航"} aria-label={"收起或展开分类导航"}>
                  <svg>
                    <use href={"#i-panel"} />
                  </svg>
                </button>
                {"\n          "}
                <span id={"crumb"} data-i18n={"未分类"}>
                  {"未分类"}
                </span>
                {"\n          "}
                <span className={"sep"}>
                  {"/"}
                </span>
                {"\n          "}
                <span id={"crumbTitle"} />
                {"\n        "}
              </div>
              {"\n        "}
              <div className={"editactions"}>
                {"\n          "}
                <span className={"saved"} id={"saveState"} />
                {"\n          "}
                <div className={"modes"}>
                  {"\n            "}
                  <button className={"active"} id={"editMode"} data-i18n={"编辑"}>
                    {"编辑"}
                  </button>
                  {"\n            "}
                  <button id={"previewMode"} data-i18n={"预览"}>
                    {"预览"}
                  </button>
                  {"\n          "}
                </div>
                {"\n          "}
                <button className={"iconbtn"} id={"historyBtn"} data-i18n-title={"历史版本"} data-i18n-aria={"历史版本"} title={"历史版本"} aria-label={"历史版本"}>
                  <svg>
                    <use href={"#i-history"} />
                  </svg>
                </button>
                {"\n          "}
                <button className={"iconbtn"} id={"focus"} data-i18n-title={"专注写作"} data-i18n-aria={"专注写作"} title={"专注写作"} aria-label={"专注写作"}>
                  <svg>
                    <use href={"#i-expand"} />
                  </svg>
                </button>
                {"\n        "}
              </div>
              {"\n      "}
            </header>
            {"\n\n      "}
            <div className={"formatbar"} id={"formatbar"}>
              {"\n        "}
              <button data-insert={"h2"} data-i18n-title={"标题"} title={"标题"}>
                {"H₂"}
              </button>
              {"\n        "}
              <button data-insert={"bold"} data-i18n-title={"加粗"} title={"加粗"}>
                <b>
                  {"B"}
                </b>
              </button>
              {"\n        "}
              <button data-insert={"italic"} data-i18n-title={"斜体"} title={"斜体"}>
                <i>
                  {"I"}
                </i>
              </button>
              {"\n        "}
              <span className={"sep"} />
              {"\n        "}
              <button data-insert={"ul"} data-i18n-title={"无序列表"} title={"无序列表"}>
                {"☷"}
              </button>
              {"\n        "}
              <button data-insert={"ol"} data-i18n-title={"有序列表"} title={"有序列表"}>
                {"☰"}
              </button>
              {"\n        "}
              <button data-insert={"quote"} data-i18n-title={"引用"} title={"引用"}>
                {"❞"}
              </button>
              {"\n        "}
              <button data-insert={"code"} data-i18n-title={"代码块"} title={"代码块"}>
                {"{ }"}
              </button>
              {"\n        "}
              <button data-insert={"link"} data-i18n-title={"链接"} title={"链接"}>
                {"↗"}
              </button>
              {"\n        "}
              <button data-insert={"table"} data-i18n-title={"表格"} title={"表格"}>
                {"▦"}
              </button>
              {"\n        "}
              <span className={"sep"} />
              {"\n        "}
              <button data-insert={"hr"} data-i18n-title={"分割线"} title={"分割线"}>
                {"—"}
              </button>
              {"\n        "}
              <span className={"spacer"} />
              {"\n        "}
              <button className={"iconbtn"} id={"pinNote"} data-i18n-title={"置顶／取消置顶"} data-i18n-aria={"置顶或取消置顶"} title={"置顶／取消置顶"} aria-label={"置顶或取消置顶"}>
                <svg>
                  <use href={"#i-pin"} />
                </svg>
              </button>
              {"\n        "}
              <button className={"iconbtn"} id={"exportNote"} data-i18n-title={"导出 Markdown"} data-i18n-aria={"导出 Markdown"} title={"导出 Markdown"} aria-label={"导出 Markdown"}>
                <svg>
                  <use href={"#i-download"} />
                </svg>
              </button>
              {"\n        "}
              <button className={"iconbtn"} id={"deleteNote"} data-i18n-title={"移到回收站"} data-i18n-aria={"移到回收站"} title={"移到回收站"} aria-label={"移到回收站"}>
                <svg>
                  <use href={"#i-trash"} />
                </svg>
              </button>
              {"\n      "}
            </div>
            {"\n\n      "}
            <div className={"editor-body"} id={"editorBody"}>
              {"\n      "}
              <article className={"document"} id={"document"}>
                {"\n        "}
                <div className={"docinner"} id={"doc"}>
                  {"\n          "}
                  <textarea className={"doctitle"} id={"docTitle"} rows={1} data-i18n-placeholder={"未命名笔记"} placeholder={"未命名笔记"} spellCheck={"false"} />
                  {"\n          "}
                  <div className={"docmeta"}>
                    {"\n            "}
                    <span id={"docNotebook"} data-i18n={"未分类"}>
                      {"未分类"}
                    </span>
                    {"\n            "}
                    <span>
                      {"·"}
                    </span>
                    {"\n            "}
                    <span id={"docDate"} />
                    {"\n            "}
                    <span className={"badge-ai hidden"} id={"docAi"}>
                      <svg>
                        <use href={"#i-sparkles"} />
                      </svg>
                      {"AI"}
                    </span>
                    {"\n            "}
                    <span id={"docTags"} />
                    {"\n            "}
                    <span className={"note-tag-control"} id={"noteTagControl"}>
                      {"\n              "}
                      <button type={"button"} className={"add-note-tag"} id={"addNoteTag"} aria-expanded={"false"} aria-controls={"noteTagPicker"} data-i18n={"＋ 标签"}>
                        {"＋ 标签"}
                      </button>
                      {"\n              "}
                      <span className={"note-tag-picker hidden"} id={"noteTagPicker"} role={"region"} data-i18n-aria={"设置笔记标签"} aria-label={"设置笔记标签"}>
                        {"\n                "}
                        <input type={"text"} id={"noteTagSearch"} maxLength={80} autoComplete={"off"} data-i18n-placeholder={"搜索或新建标签"} placeholder={"搜索或新建标签"} data-i18n-aria={"搜索或新建标签"} aria-label={"搜索或新建标签"} />
                        {"\n                "}
                        <span className={"note-tag-options"} id={"noteTagOptions"} />
                        {"\n                "}
                        <span className={"note-tag-hint"} data-i18n={"点击选择标签，输入新名称后按 Enter 创建。"}>
                          {"点击选择标签，输入新名称后按 Enter 创建。"}
                        </span>
                        {"\n              "}
                      </span>
                      {"\n            "}
                    </span>
                    {"\n          "}
                  </div>
                  {"\n          "}
                  <div className={"body-wrap"}>
                    {"\n            "}
                    <textarea className={"body"} id={"docBody"} data-i18n-placeholder={"从这里开始写…\n\n支持 Markdown：## 标题、- 列表、**重点**、> 引用、```代码块```"} placeholder={"从这里开始写…\n\n支持 Markdown：## 标题、- 列表、**重点**、> 引用、```代码块```"} spellCheck={"false"} />
                    {"\n            "}
                    <div className={"preview hidden"} id={"preview"} />
                    {"\n          "}
                  </div>
                  {"\n        "}
                </div>
                {"\n        "}
                <div className={"editor-empty hidden"} id={"editorEmpty"}>
                  {"\n          "}
                  <div className={"mark"}>
                    <svg>
                      <use href={"#i-note"} />
                    </svg>
                  </div>
                  {"\n          "}
                  <div data-i18n-html={"empty.editor"}>
                    {"选择一篇笔记，开始阅读或写作。"}
                    <br />
                    {"AI 也可以直接把文档写进这里。"}
                  </div>
                  {"\n          "}
                  <button className={"primary"} id={"emptyNew"}>
                    <svg>
                      <use href={"#i-plus"} />
                    </svg>
                    <span data-i18n={"新建笔记"}>
                      {"新建笔记"}
                    </span>
                  </button>
                  {"\n        "}
                </div>
                {"\n      "}
              </article>
              {"\n      "}
              <div className={"editor-scrollbar hidden"} id={"editorScrollbar"} aria-hidden={"true"}>
                {"\n        "}
                <span className={"editor-scroll-thumb"} id={"editorScrollThumb"} />
                {"\n      "}
              </div>
              {"\n      "}
            </div>
            {"\n\n      "}
            <footer className={"editorfooter"}>
              {"\n        "}
              <span id={"wordCount"} />
              {"\n        "}
              <span className={"right"}>
                <span id={"docId"} />
                <span data-i18n={"让想法有处安放"}>
                  {"让想法有处安放"}
                </span>
              </span>
              {"\n      "}
            </footer>
            {"\n    "}
          </main>
          {"\n\n"}
          {"\n"}
          <div className={"settings-page hidden"} id={"settingsPage"}>
            {"\n  "}
            <section className={"settings"} role={"region"} aria-labelledby={"settingsTitle"}>
              {"\n    "}
              <header className={"settings-head"}>
                {"\n      "}
                <div>
                  {"\n        "}
                  <h2 id={"settingsTitle"} data-i18n={"偏好设置"}>
                    {"偏好设置"}
                  </h2>
                  {"\n        "}
                  <p data-i18n={"在此调整外观、语言、数据与 AI 接入行为，设置会保存在本地数据库。"}>
                    {"在此调整外观、语言、数据与 AI 接入行为，设置会保存在本地数据库。"}
                  </p>
                  {"\n      "}
                </div>
                {"\n      "}
                <button className={"iconbtn"} id={"settingsClose"} data-i18n-aria={"关闭"} aria-label={"关闭"}>
                  <svg>
                    <use href={"#i-x"} />
                  </svg>
                </button>
                {"\n    "}
              </header>
              {"\n\n    "}
              <div className={"settings-main"}>
                {"\n      "}
                <nav className={"settings-tabs"} id={"settingsTabs"} data-i18n-aria={"设置"} aria-label={"设置"}>
                  {"\n        "}
                  <button className={"active"} data-settings-tab={"general"}>
                    <svg>
                      <use href={"#i-gear"} />
                    </svg>
                    <span data-i18n={"通用"}>
                      {"通用"}
                    </span>
                  </button>
                  {"\n        "}
                  <button data-settings-tab={"data"}>
                    <svg>
                      <use href={"#i-book"} />
                    </svg>
                    <span data-i18n={"数据与备份"}>
                      {"数据与备份"}
                    </span>
                  </button>
                  {"\n        "}
                  <button data-settings-tab={"mcp"}>
                    <svg>
                      <use href={"#i-plug"} />
                    </svg>
                    <span data-i18n={"MCP 与 AI"}>
                      {"MCP 与 AI"}
                    </span>
                  </button>
                  {"\n        "}
                  <button data-plugin-shell="settings-tab" data-settings-tab="plugins">
                    <svg><use href="#i-plug" /></svg>
                    <span data-i18n="插件">插件</span>
                  </button>
                  <button data-settings-tab={"about"}>
                    <svg>
                      <use href={"#i-info"} />
                    </svg>
                    <span data-i18n={"关于"}>
                      {"关于"}
                    </span>
                  </button>
                  {"\n      "}
                </nav>
                {"\n\n      "}
                <div className={"settings-panels"} id={"settingsPanels"}>
                  {"\n\n        "}
                  {"\n        "}
                  <div className={"settings-panel"} data-panel={"general"}>
                    {"\n          "}
                    <div className={"set-section"}>
                      {"\n            "}
                      <h3 data-i18n={"外观"}>
                        {"外观"}
                      </h3>
                      {"\n            "}
                      <p className={"set-hint"} data-i18n={"选择喜欢的界面配色，设置会自动保存。"}>
                        {"选择喜欢的界面配色，设置会自动保存。"}
                      </p>
                      {"\n            "}
                      <div className={"set-row"}>
                        {"\n              "}
                        <span id={"themeLabel"} data-i18n={"外观主题"}>
                          {"外观主题"}
                        </span>
                        {"\n              "}
                        <div className={"theme-swatches"} id={"themeSwatches"} role={"group"} aria-labelledby={"themeLabel"}>
                          {"\n                "}
                          <button type={"button"} className={"theme-swatch"} data-theme-choice={"green"} style={{"--swatch": "#22c55e"} as CSSProperties} aria-pressed={"false"} data-i18n-aria={"草木绿"} aria-label={"草木绿"} data-i18n-title={"草木绿"} title={"草木绿"}>
                            <span aria-hidden={"true"}>
                              {"✓"}
                            </span>
                          </button>
                          {"\n                "}
                          <button type={"button"} className={"theme-swatch"} data-theme-choice={"coral"} style={{"--swatch": "#e04747"} as CSSProperties} aria-pressed={"false"} data-i18n-aria={"珊瑚红"} aria-label={"珊瑚红"} data-i18n-title={"珊瑚红"} title={"珊瑚红"}>
                            <span aria-hidden={"true"}>
                              {"✓"}
                            </span>
                          </button>
                          {"\n                "}
                          <button type={"button"} className={"theme-swatch"} data-theme-choice={"sunset"} style={{"--swatch": "#f86a3b"} as CSSProperties} aria-pressed={"false"} data-i18n-aria={"落日橙"} aria-label={"落日橙"} data-i18n-title={"落日橙"} title={"落日橙"}>
                            <span aria-hidden={"true"}>
                              {"✓"}
                            </span>
                          </button>
                          {"\n                "}
                          <button type={"button"} className={"theme-swatch"} data-theme-choice={"blue"} style={{"--swatch": "#4387c5"} as CSSProperties} aria-pressed={"false"} data-i18n-aria={"雾蓝"} aria-label={"雾蓝"} data-i18n-title={"雾蓝"} title={"雾蓝"}>
                            <span aria-hidden={"true"}>
                              {"✓"}
                            </span>
                          </button>
                          {"\n                "}
                          <button type={"button"} className={"theme-swatch"} data-theme-choice={"lavender"} style={{"--swatch": "#9470c7"} as CSSProperties} aria-pressed={"false"} data-i18n-aria={"薰衣草紫"} aria-label={"薰衣草紫"} data-i18n-title={"薰衣草紫"} title={"薰衣草紫"}>
                            <span aria-hidden={"true"}>
                              {"✓"}
                            </span>
                          </button>
                          {"\n              "}
                        </div>
                        {"\n            "}
                      </div>
                      {"\n            "}
                      <div className={"set-row"}>
                        {"\n              "}
                        <label htmlFor={"setLanguage"} data-i18n={"界面语言"}>
                          {"界面语言"}
                        </label>
                        {"\n              "}
                        <select id={"setLanguage"} data-setting={"language"}>
                          {"\n                "}
                          <option value={"zh-CN"} data-i18n={"简体中文"}>
                            {"简体中文"}
                          </option>
                          {"\n                "}
                          <option value={"en-US"}>
                            {"English"}
                          </option>
                          {"\n              "}
                        </select>
                        {"\n            "}
                      </div>
                      {"\n          "}
                    </div>
                    {"\n\n          "}
                    <div className={"set-section"}>
                      {"\n            "}
                      <h3 data-i18n={"编辑器默认值"}>
                        {"编辑器默认值"}
                      </h3>
                      {"\n            "}
                      <p className={"set-hint"} data-i18n={"打开笔记时默认进入编辑或阅读视图。"}>
                        {"打开笔记时默认进入编辑或阅读视图。"}
                      </p>
                      {"\n            "}
                      <div className={"set-row"}>
                        {"\n              "}
                        <label htmlFor={"setEditorMode"} data-i18n={"默认视图"}>
                          {"默认视图"}
                        </label>
                        {"\n              "}
                        <select id={"setEditorMode"} data-setting={"editorMode"}>
                          {"\n                "}
                          <option value={"auto"} data-i18n={"自动（AI 笔记用阅读）"}>
                            {"自动（AI 笔记用阅读）"}
                          </option>
                          {"\n                "}
                          <option value={"edit"} data-i18n={"编辑模式"}>
                            {"编辑模式"}
                          </option>
                          {"\n                "}
                          <option value={"preview"} data-i18n={"阅读模式"}>
                            {"阅读模式"}
                          </option>
                          {"\n              "}
                        </select>
                        {"\n            "}
                      </div>
                      {"\n            "}
                      <div className={"set-row"}>
                        {"\n              "}
                        <label htmlFor={"setFontSize"} data-i18n={"正文字号"}>
                          {"正文字号"}
                        </label>
                        {"\n              "}
                        <select id={"setFontSize"} data-setting={"fontSize"}>
                          {"\n                "}
                          <option value={"small"} data-i18n={"小"}>
                            {"小"}
                          </option>
                          {"\n                "}
                          <option value={"medium"} data-i18n={"中"}>
                            {"中"}
                          </option>
                          {"\n                "}
                          <option value={"large"} data-i18n={"大"}>
                            {"大"}
                          </option>
                          {"\n              "}
                        </select>
                        {"\n            "}
                      </div>
                      {"\n          "}
                    </div>
                    {"\n\n          "}
                    <div className={"set-section"}>
                      {"\n            "}
                      <h3 data-i18n={"常用快捷键"}>
                        {"常用快捷键"}
                      </h3>
                      {"\n            "}
                      <div className={"shortcuts"}>
                        {"\n              "}
                        <div>
                          <kbd>
                            {"⌘ K"}
                          </kbd>
                          <span data-i18n={"搜索笔记"}>
                            {"搜索笔记"}
                          </span>
                        </div>
                        {"\n              "}
                        <div>
                          <kbd>
                            {"⌘ S"}
                          </kbd>
                          <span data-i18n={"保存当前笔记"}>
                            {"保存当前笔记"}
                          </span>
                        </div>
                        {"\n              "}
                        <div>
                          <kbd>
                            {"⌘ N"}
                          </kbd>
                          <span data-i18n={"新建笔记"}>
                            {"新建笔记"}
                          </span>
                        </div>
                        {"\n              "}
                        <div>
                          <kbd>
                            {"Esc"}
                          </kbd>
                          <span data-i18n={"退出专注模式"}>
                            {"退出专注模式"}
                          </span>
                        </div>
                        {"\n            "}
                      </div>
                      {"\n          "}
                    </div>
                    {"\n        "}
                  </div>
                  {"\n\n        "}
                  {"\n        "}
                  <div className={"settings-panel hidden"} data-panel={"data"}>
                    {"\n          "}
                    <div className={"set-section"}>
                      {"\n            "}
                      <h3 data-i18n={"数据存放位置"}>
                        {"数据存放位置"}
                      </h3>
                      {"\n            "}
                      <p className={"set-hint"} data-i18n={"数据以明文 Markdown 存放在本机 SQLite 文件中；复制该文件即为完整备份。"}>
                        {"数据以明文 Markdown 存放在本机 SQLite 文件中；复制该文件即为完整备份。"}
                      </p>
                      {"\n            "}
                      <div className={"set-path"}>
                        <span className={"mono"} id={"setDbPath"}>
                          {"—"}
                        </span>
                        <button className={"ghost-btn"} id={"copyDbPath"} data-i18n={"复制路径"}>
                          {"复制路径"}
                        </button>
                      </div>
                      {"\n          "}
                    </div>
                    {"\n\n          "}
                    <div className={"set-section"}>
                      {"\n            "}
                      <h3 data-i18n={"导出与备份"}>
                        {"导出与备份"}
                      </h3>
                      {"\n            "}
                      <p className={"set-hint"} data-i18n={"导出为 Markdown 压缩包（.zip），每篇文件末尾附带分类和标签标记；支持直接导入 ZIP 或单篇 Markdown。"}>
                        {"导出为 Markdown 压缩包（.zip），每篇文件末尾附带分类和标签标记；支持直接导入 ZIP 或单篇 Markdown。"}
                      </p>
                      {"\n            "}
                      <div className={"set-actions"}>
                        {"\n              "}
                        <button className={"ghost-btn"} id={"exportMarkdown"} data-i18n={"导出 Markdown"}>
                          {"导出 Markdown"}
                        </button>
                        {"\n            "}
                      </div>
                      {"\n          "}
                    </div>
                    {"\n\n          "}
                    <div className={"set-section"}>
                      {"\n            "}
                      <h3 data-i18n={"导入 Markdown"}>
                        {"导入 Markdown"}
                      </h3>
                      {"\n            "}
                      <p className={"set-hint"} data-i18n={"选择 Markdown 或 ZIP 文件；本软件导出的文件会从末尾标记还原标题、分类和标签，无标记则按普通 Markdown 导入。"}>
                        {"选择 Markdown 或 ZIP 文件；本软件导出的文件会从末尾标记还原标题、分类和标签，无标记则按普通 Markdown 导入。"}
                      </p>
                      {"\n            "}
                      <div className={"set-actions"}>
                        {"\n              "}
                        <input type={"file"} id={"importFiles"} className={"hidden"} accept={".md,.markdown,.txt,.zip,text/markdown,text/plain,application/zip"} multiple />
                        {"\n              "}
                        <label htmlFor={"importDuplicates"} data-i18n={"重复笔记"}>
                          {"重复笔记"}
                        </label>
                        <select id={"importDuplicates"}>
                          <option value={"skip"}>
                            {"跳过（默认）"}
                          </option>
                          <option value={"replace"}>
                            {"覆盖已有笔记"}
                          </option>
                          <option value={"copy"}>
                            {"保留两份"}
                          </option>
                        </select>
                        {"\n              "}
                        <button className={"ghost-btn"} id={"importPick"} data-i18n={"选择文件"}>
                          {"选择文件"}
                        </button>
                        {"\n              "}
                        <span className={"set-note"} id={"importStatus"} />
                        {"\n            "}
                      </div>
                      {"\n          "}
                    </div>
                    {"\n\n          "}
                    <div className={"set-section danger"}>
                      {"\n            "}
                      <h3 data-i18n={"危险操作"}>
                        {"危险操作"}
                      </h3>
                      {"\n            "}
                      <p className={"set-hint"} data-i18n={"永久删除回收站里的全部笔记，此操作无法撤销。"}>
                        {"永久删除回收站里的全部笔记，此操作无法撤销。"}
                      </p>
                      {"\n            "}
                      <div className={"set-actions"}>
                        {"\n              "}
                        <button className={"danger-btn"} id={"emptyTrash"} data-i18n={"清空回收站"}>
                          {"清空回收站"}
                        </button>
                        {"\n              "}
                        <span className={"set-note"} id={"trashTotal"} />
                        {"\n            "}
                      </div>
                      {"\n          "}
                    </div>
                    {"\n        "}
                  </div>
                  {"\n\n        "}
                  {"\n        "}
                  <div className={"settings-panel hidden"} data-panel={"mcp"}>
                    {"\n          "}
                    <div className={"set-section"}>
                      {"\n            "}
                      <h3 data-i18n={"服务"}>
                        {"服务"}
                      </h3>
                      {"\n            "}
                      <div className={"kv"}>
                        {"\n              "}
                        <div>
                          <span data-i18n={"状态"}>
                            {"状态"}
                          </span>
                          <b id={"setStatus"}>
                            {"—"}
                          </b>
                        </div>
                        {"\n              "}
                        <div>
                          <span data-i18n={"MCP 端点"}>
                            {"MCP 端点"}
                          </span>
                          <b className={"mono"} id={"setEndpoint"}>
                            {"—"}
                          </b>
                        </div>
                        {"\n              "}
                        <div>
                          <span data-i18n={"协议版本"}>
                            {"协议版本"}
                          </span>
                          <b className={"mono"} id={"setProtocol"}>
                            {"—"}
                          </b>
                        </div>
                        {"\n              "}
                        <div>
                          <span data-i18n={"工具"}>
                            {"工具"}
                          </span>
                          <b id={"setToolCount"}>
                            {"—"}
                          </b>
                        </div>
                        {"\n            "}
                      </div>
                      {"\n          "}
                    </div>
                    {"\n\n          "}
                    <div className={"set-section"}>
                      {"\n            "}
                      <h3 data-i18n={"访问令牌"}>
                        {"访问令牌"}
                      </h3>
                      {"\n            "}
                      <p className={"set-hint"} data-i18n={"打开「接入 AI」面板更换全局令牌，或复制端点与客户端配置。"}>
                        {"打开「接入 AI」面板更换全局令牌，或复制端点与客户端配置。"}
                      </p>
                      {"\n            "}
                      <div className={"set-actions"}>
                        <button className={"ghost-btn"} id={"openConnect"} data-i18n={"打开接入面板"}>
                          {"打开接入面板"}
                        </button>
                      </div>
                      {"\n          "}
                    </div>
                    {"\n\n          "}
                    <div className={"set-section"}>
                      {"\n            "}
                      <h3 data-i18n={"AI 行为"}>
                        {"AI 行为"}
                      </h3>
                      {"\n            "}
                      <div className={"set-row"}>
                        {"\n              "}
                        <label htmlFor={"setAiNotebook"} data-i18n={"AI 写入默认笔记本"}>
                          {"AI 写入默认笔记本"}
                        </label>
                        {"\n              "}
                        <select id={"setAiNotebook"} data-setting={"aiNotebook"} />
                        {"\n            "}
                      </div>
                      {"\n            "}
                      <p className={"set-hint"} data-i18n={"留空表示未分类；AI 保存文档时若未指定笔记本，会写入这里。"}>
                        {"留空表示未分类；AI 保存文档时若未指定笔记本，会写入这里。"}
                      </p>
                      {"\n            "}
                      <label className={"check"}>
                        <input type={"checkbox"} id={"setAiBadge"} data-setting={"showAiBadge"} />
                        <span data-i18n={"在笔记列表里显示 AI 写入标记"}>
                          {"在笔记列表里显示 AI 写入标记"}
                        </span>
                      </label>
                      {"\n          "}
                    </div>
                    {"\n        "}
                  </div>
                  {"\n\n        "}
                  {"\n        "}
                  <div className="settings-panel hidden" data-panel="plugins" data-plugin-shell="settings-panel">
                    <DeferredPluginSettings />
                  </div>
                  <div className={"settings-panel hidden"} data-panel={"about"}>
                    {"\n          "}
                    <div className={"set-section"}>
                      {"\n            "}
                      <div className={"about-copy"} id={"settingsAbout"} />
                      {"\n          "}
                    </div>
                    {"\n        "}
                  </div>
                  {"\n\n      "}
                </div>
                {"\n    "}
              </div>
              {"\n\n    "}
              <footer className={"settings-foot"}>
                {"\n      "}
                <span className={"set-note"} data-i18n={"纯本地 · 无账号 · 无加密 · 支持 MCP"}>
                  {"纯本地 · 无账号 · 无加密 · 支持 MCP"}
                </span>
                {"\n      "}
                <button className={"ghost-btn"} id={"settingsReset"} data-i18n={"重置为默认"}>
                  {"重置为默认"}
                </button>
                {"\n    "}
              </footer>
              {"\n  "}
            </section>
            {"\n"}
          </div>
          {"\n\n  "}
        </div>
        {"\n\n  "}
        <footer className={"foot"}>
          {"\n    "}
          <span id={"footInfo"} data-i18n={"本地明文存储 · 无加密 · 通过 MCP 与 AI 协作"}>
            {"本地明文存储 · 无加密 · 通过 MCP 与 AI 协作"}
          </span>
          {"\n    "}
          <span className={"secondary"} data-i18n-html={"foot.shortcuts"}>
            {"⌘ K 搜索 · ⌘ S 保存 · ⌘ N 新建 · Esc 退出专注"}
          </span>
          {"\n  "}
        </footer>
        {"\n\n"}
      </div>
    </>
  )
}
