// Keep DOM identifiers and markup stable for the workspace controllers.
export function Overlays() {
  return (
    <>
      <div className={"toast"} id={"toast"} role={"status"} />
      <div className={"overlay"} id={"exportOverlay"} role={"dialog"} aria-modal={"true"} data-i18n-aria={"导出备份"} aria-label={"导出备份"}>
        {"\n  "}
        <div className={"dialog export-dialog"}>
          {"\n    "}
          <h2 data-i18n={"正在导出备份"}>
            {"正在导出备份"}
          </h2>
          {"\n    "}
          <p className={"dialog-hint"} id={"exportStage"} data-i18n={"正在读取笔记并打包…"}>
            {"正在读取笔记并打包…"}
          </p>
          {"\n    "}
          <div className={"progress-track"}>
            <div className={"progress-bar"} id={"exportBar"} />
          </div>
          {"\n    "}
          <div className={"progress-meta"}>
            <span id={"exportBytes"}>
              {"0 KB"}
            </span>
            <span className={"mono"} id={"exportPct"}>
              {"0%"}
            </span>
          </div>
          {"\n    "}
          <div className={"export-actions"}>
            {"\n      "}
            <button className={"ghost-btn"} id={"exportCancel"} data-i18n={"取消"}>
              {"取消"}
            </button>
            {"\n    "}
          </div>
          {"\n  "}
        </div>
        {"\n"}
      </div>
      <div className={"overlay"} id={"trashOverlay"} role={"dialog"} aria-modal={"true"} data-i18n-aria={"清空回收站"} aria-label={"清空回收站"}>
        {"\n  "}
        <div className={"dialog export-dialog"}>
          {"\n    "}
          <h2 data-i18n={"正在清空回收站"}>
            {"正在清空回收站"}
          </h2>
          {"\n    "}
          <p className={"dialog-hint"} id={"trashStage"} data-i18n={"正在读取回收站…"}>
            {"正在读取回收站…"}
          </p>
          {"\n    "}
          <div className={"progress-track"}>
            <div className={"progress-bar"} id={"trashBar"} />
          </div>
          {"\n    "}
          <div className={"progress-meta"}>
            <span id={"trashMeta"}>
              {"0 / 0 篇"}
            </span>
            <span className={"mono"} id={"trashPct"}>
              {"0%"}
            </span>
          </div>
          {"\n    "}
          <div className={"export-actions"}>
            {"\n      "}
            <button className={"ghost-btn"} id={"trashCancel"} data-i18n={"取消"}>
              {"取消"}
            </button>
            {"\n    "}
          </div>
          {"\n  "}
        </div>
        {"\n"}
      </div>
      <div className={"ctxmenu hidden"} id={"ctxMenu"} role={"menu"} data-i18n-aria={"操作菜单"} aria-label={"操作菜单"}>
        {"\n  "}
        <div className={"ctxmenu-head"} id={"ctxHead"} />
        {"\n  "}
        <div id={"ctxItems"} />
        {"\n"}
      </div>
      <div className={"overlay"} id={"formOverlay"}>
        {"\n  "}
        <section className={"dialog"} role={"dialog"} aria-modal={"true"} aria-labelledby={"formTitle"}>
          {"\n    "}
          <h2 id={"formTitle"} />
          {"\n    "}
          <p className={"dialog-hint hidden"} id={"formHint"} />
          {"\n    "}
          <label className={"dialog-field hidden"} id={"formInputWrap"}>
            {"\n      "}
            <span id={"formLabel"} />
            {"\n      "}
            <input type={"text"} id={"formInput"} autoComplete={"off"} spellCheck={"false"} />
            {"\n    "}
          </label>
          {"\n    "}
          <label className={"dialog-field hidden"} id={"formSelectWrap"}>
            {"\n      "}
            <span id={"formSelectLabel"} />
            {"\n      "}
            <select id={"formSelect"} />
            {"\n    "}
          </label>
          {"\n    "}
          <p className={"dialog-error hidden"} id={"formError"} />
          {"\n    "}
          <div className={"dialog-actions"}>
            {"\n      "}
            <button className={"ghost-btn"} id={"formCancel"} data-i18n={"取消"}>
              {"取消"}
            </button>
            {"\n      "}
            <button className={"primary"} id={"formConfirm"} data-i18n={"确定"}>
              {"确定"}
            </button>
            {"\n    "}
          </div>
          {"\n  "}
        </section>
        {"\n"}
      </div>
      <aside className={"drawer"} id={"drawer"} data-i18n-aria={"接入 AI"} aria-label={"接入 AI"}>
        {"\n  "}
        <div className={"drawer-head"}>
          {"\n    "}
          <div>
            {"\n      "}
            <h2 id={"drawerTitle"} data-i18n={"接入 AI"}>
              {"接入 AI"}
            </h2>
            {"\n      "}
            <p id={"drawerSub"} data-i18n={"把下面这个 MCP 端点填进任意支持 MCP 的客户端，AI 就能读写你的笔记。"}>
              {"把下面这个 MCP 端点填进任意支持 MCP 的客户端，AI 就能读写你的笔记。"}
            </p>
            {"\n    "}
          </div>
          {"\n    "}
          <button className={"iconbtn"} id={"drawerClose"} data-i18n-aria={"关闭"} aria-label={"关闭"}>
            <svg>
              <use href={"#i-x"} />
            </svg>
          </button>
          {"\n  "}
        </div>
        {"\n  "}
        <div className={"drawer-body"}>
          {"\n    "}
          <div className={"tabs"} id={"drawerTabs"}>
            {"\n      "}
            <button data-tab={"connect"} className={"active"} data-i18n={"接入配置"}>
              {"接入配置"}
            </button>
            {"\n      "}
            <button data-tab={"tools"} data-i18n={"工具"}>
              {"工具"}
            </button>
            {"\n      "}
            <button data-tab={"activity"} data-i18n={"活动"}>
              {"活动"}
            </button>
            {"\n    "}
          </div>
          {"\n\n    "}
          <div id={"panel-connect"}>
            {"\n      "}
            <div className={"field"}>
              {"\n        "}
              <label data-i18n={"MCP 端点（Streamable HTTP）"}>
                {"MCP 端点（Streamable HTTP）"}
              </label>
              {"\n        "}
              <div className={"codebox"} id={"endpointBox"}>
                {"—"}
                <button className={"copy"} data-copy={"endpoint"}>
                  <span data-i18n={"复制"}>
                    {"复制"}
                  </span>
                </button>
              </div>
              {"\n        "}
              <div className={"hint"} data-i18n={"默认只监听本机，令牌校验开启；把地址换成局域网 IP 即可让同一网络中的设备接入。"}>
                {"默认只监听本机，令牌校验开启；把地址换成局域网 IP 即可让同一网络中的设备接入。"}
              </div>
              {"\n      "}
            </div>
            {"\n      "}
            <div className={"field"}>
              {"\n        "}
              <div className={"token-heading"}>
                <label data-i18n={"访问令牌"}>
                  {"访问令牌"}
                </label>
                <button className={"ghost-btn"} id={"rotateToken"} data-i18n={"更换"}>
                  {"更换"}
                </button>
              </div>
              {"\n        "}
              <div className={"codebox"} id={"tokenBox"}>
                {"—"}
                <button className={"copy"} data-copy={"token"}>
                  <span data-i18n={"复制"}>
                    {"复制"}
                  </span>
                </button>
              </div>
              {"\n        "}
              <div className={"hint"} data-i18n={"全局共用一个访问令牌；更换后旧令牌立即失效，请更新客户端配置。"}>
                {"全局共用一个访问令牌；更换后旧令牌立即失效，请更新客户端配置。"}
              </div>
              {"\n      "}
            </div>
            {"\n\n      "}
            <div className={"section-title"}>
              <span data-i18n={"客户端配置"}>
                {"客户端配置"}
              </span>
            </div>
            {"\n      "}
            <div className={"tabs"} id={"clientTabs"} style={{"marginBottom": "12px"}}>
              {"\n        "}
              <button data-client={"claude"} className={"active"}>
                {"Claude Code"}
              </button>
              {"\n        "}
              <button data-client={"desktop"}>
                {"Claude Desktop"}
              </button>
              {"\n        "}
              <button data-client={"codex"}>
                {"Codex"}
              </button>
              {"\n        "}
              <button data-client={"json"} data-i18n={"通用 JSON"}>
                {"通用 JSON"}
              </button>
              {"\n      "}
            </div>
            {"\n      "}
            <div className={"codebox"} id={"clientBox"}>
              {"—"}
              <button className={"copy"} data-copy={"client"}>
                <span data-i18n={"复制"}>
                  {"复制"}
                </span>
              </button>
            </div>
            {"\n      "}
            <div className={"hint"} id={"clientHint"} />
            {"\n\n      "}
            <div className={"section-title"}>
              <span data-i18n={"它是怎么工作的"}>
                {"它是怎么工作的"}
              </span>
            </div>
            {"\n      "}
            <div className={"tool-item"}>
              {"\n        "}
              <div className={"desc"} style={{"marginTop": "0"}} data-i18n-html={"drawer.how"}>
                {"\n          网页界面和 MCP 服务共用同一个本地 SQLite 数据库。AI 通过 MCP 写入的笔记会立刻出现在左侧列表里\n          （带 "}
                <span className={"badge-ai"} style={{"verticalAlign": "1px"}}>
                  <svg>
                    <use href={"#i-sparkles"} />
                  </svg>
                  {"AI"}
                </span>
                {" 标记），\n          你可以在网页里继续编辑，也可以让 AI 追加内容。所有笔记都是纯 Markdown 明文。\n        "}
              </div>
              {"\n      "}
            </div>
            {"\n    "}
          </div>
          {"\n\n    "}
          <div id={"panel-tools"} className={"hidden"}>
            {"\n      "}
            <div className={"section-title"}>
              <span data-i18n={"工具"}>
                {"工具"}
              </span>
              {" "}
              <span id={"toolCount"} />
            </div>
            {"\n      "}
            <div className={"tool-list"} id={"toolList"} />
            {"\n      "}
            <div className={"section-title"}>
              <span data-i18n={"资源"}>
                {"资源"}
              </span>
            </div>
            {"\n      "}
            <div className={"tool-list"} id={"resourceList"} />
            {"\n      "}
            <div className={"section-title"}>
              <span data-i18n={"提示模板"}>
                {"提示模板"}
              </span>
            </div>
            {"\n      "}
            <div className={"tool-list"} id={"promptList"} />
            {"\n    "}
          </div>
          {"\n\n    "}
          <div id={"panel-activity"} className={"hidden"}>
            {"\n      "}
            <div className={"section-title"}>
              <span data-i18n={"最近活动"}>
                {"最近活动"}
              </span>
            </div>
            {"\n      "}
            <div id={"activityList"} />
            {"\n    "}
          </div>
          {"\n  "}
        </div>
        {"\n"}
      </aside>
      <div className={"overlay"} id={"drawerOverlay"} />
      <div className={"overlay"} id={"dialogOverlay"}>
        {"\n  "}
        <section className={"dialog"} style={{"background": "var(--paper)", "borderRadius": "14px", "width": "min(560px,100%)", "padding": "30px", "boxShadow": "var(--shadow)", "margin": "auto"}}>
          {"\n    "}
          <h2 style={{"margin": "0 0 16px", "fontSize": "20px"}} id={"dialogTitle"} data-i18n={"关于 LockNote.app"}>
            {"关于 LockNote.app"}
          </h2>
          {"\n    "}
          <div id={"dialogBody"} style={{"fontSize": "13px", "lineHeight": "1.9", "color": "var(--muted)"}} />
          {"\n    "}
          <button className={"primary"} id={"dialogClose"} style={{"marginTop": "14px"}} data-i18n={"关闭"}>
            {"关闭"}
          </button>
          {"\n  "}
        </section>
        {"\n"}
      </div>
    </>
  )
}
