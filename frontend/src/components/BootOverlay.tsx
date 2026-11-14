// Keep DOM identifiers and markup stable for the workspace controllers.
export function BootOverlay() {
  return (
    <>
      <div className={"boot-overlay"} id={"bootOverlay"} role={"status"} aria-live={"polite"}>
        {"\n  "}
        <div className={"boot-card"}>
          {"\n    "}
          <img className={"boot-logo"} src={"/icon.svg"} alt={""} width={"64"} height={"64"} aria-hidden={"true"} />
          {"\n    "}
          <div className={"boot-title"} data-i18n={"正在打开笔记库"}>
            {"正在打开笔记库"}
          </div>
          {"\n    "}
          <div className={"boot-track"}>
            <div className={"boot-bar"} id={"bootBar"} />
          </div>
          {"\n    "}
          <div className={"boot-meta"}>
            {"\n      "}
            <span id={"bootLabel"} data-i18n={"正在初始化…"}>
              {"正在初始化…"}
            </span>
            {"\n      "}
            <span className={"mono"} id={"bootPct"}>
              {"0%"}
            </span>
            {"\n    "}
          </div>
          {"\n  "}
        </div>
        {"\n"}
      </div>
    </>
  )
}
