/** Keep app shortcuts behind the modal inactive; selection/copy remain native. */
export function blockWorkspaceShortcut(event:Pick<KeyboardEvent,'key'|'ctrlKey'|'metaKey'|'altKey'>):boolean {return (event.ctrlKey||event.metaKey)&&['n','k','s','p'].includes(event.key.toLowerCase())||event.key==='F10'||event.key==='ContextMenu'}
