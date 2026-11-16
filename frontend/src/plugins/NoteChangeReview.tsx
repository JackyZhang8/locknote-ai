import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { diffLines, noteChanges, type ChangeEntry } from './note-changes.js'
import { t, errorMessage } from './ui-text.js'
export function NoteChangeReview() {
 const snapshot = useSyncExternalStore(noteChanges.subscribe, noteChanges.getSnapshot, noteChanges.getSnapshot)
 const entry = snapshot.entries.find(item => item.id === snapshot.activeId)
 return entry ? <NoteChangeReviewContent key={entry.id} entry={entry} warning={snapshot.warning} /> : null
}

export function PendingNoteDrafts({ entries }: { entries: ChangeEntry[] }) {
 const pending = entries.filter(entry => entry.state === 'pending')
 if (!pending.length) return null
 return <aside className="note-change-banner" aria-label={t('待应用的 AI 建议稿', 'Unapplied AI drafts')}>
  {pending.map(entry => <div key={entry.id}><span>{t('有 AI 建议稿待应用', 'AI draft awaiting application')} · {entry.title}</span><button onClick={() => noteChanges.open(entry.id)}>{t('继续审阅', 'Continue reviewing')}</button></div>)}
 </aside>
}

export function NoteChangeReviewContent({ entry, warning }: { entry: ChangeEntry; warning: string }) {
 const [confirmation, setConfirmation] = useState<'minimize' | 'discard' | null>(null)
 const dialog = useRef<HTMLDivElement>(null)
 useEffect(() => {
  if (!confirmation || entry.state !== 'pending') return
  const previous = document.activeElement as HTMLElement | null
  dialog.current?.focus()
  const keydown = (event: KeyboardEvent) => {
   if (event.key === 'Escape') { event.preventDefault();event.stopPropagation();if (!entry.busy) setConfirmation(null);return }
   if (event.key !== 'Tab') { if ((event.ctrlKey || event.metaKey) && !['c', 'a', 'x', 'v', 'z'].includes(event.key.toLowerCase())) event.stopPropagation();return }
   event.stopPropagation()
   const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])
   const first = buttons[0], last = buttons[buttons.length - 1]
   if (!first) { event.preventDefault();return }
   if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault();last.focus() }
   else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault();first.focus() }
  }
  document.addEventListener('keydown', keydown, true)
  return () => { document.removeEventListener('keydown', keydown, true);previous?.focus() }
 }, [confirmation, entry.busy, entry.state])
 const [mode, setMode] = useState<'edit' | 'diff' | 'original'>('diff'), [error, setError] = useState('')
 const lines = useMemo(() => mode === 'diff' ? diffLines(entry.before?.content || '', entry.after.content || '') : [], [mode, entry.before?.content, entry.after.content])
 const editable = entry.state === 'pending' && !entry.busy
 const status = { pending: t('尚未应用', 'Not applied'), applied: t('已应用', 'Applied'), discarded: t('已丢弃', 'Discarded'), undone: t('已撤回', 'Undone') }[entry.state]
 const run = async (action: () => Promise<unknown>) => { setError('');try { await action() } catch (reason) { setError(errorMessage(reason)) } }
 const edit = (patch: Parameters<typeof noteChanges.edit>[1]) => { try { noteChanges.edit(entry.id, patch);setError('') } catch (reason) { setError(errorMessage(reason)) } }
 return <section className="note-change-review" aria-label={t('AI 笔记改动审阅', 'Review AI note changes')}>
  <header><div><strong>{t('笔记改动', 'Note changes')} · {status}</strong><small>{entry.title} · {entry.pluginId}</small></div><button autoFocus disabled={entry.busy} onClick={() => { setError('');if (entry.state === 'pending') setConfirmation('minimize');else noteChanges.close() }}>{t('收起', 'Minimize')}</button></header>
  {entry.state === 'pending' && <p className="note-change-pending">{t('建议稿已生成，尚未保存到笔记。应用修改后才会保存。', 'Draft generated; not yet saved to the note. Apply changes to save it.')}</p>}
  <nav>{(['diff', 'edit', 'original'] as const).map(value => <button key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>{value === 'diff' ? t('查看差异', 'Changes') : value === 'edit' ? t('编辑建议稿', 'Edit draft') : t('原文', 'Original')}</button>)}</nav>
  <div className="note-change-scroll">
   {entry.recovered && <p>{t('从本机恢复的记录；应用前会重新校验原文版本。', 'Recovered locally. Original version will be checked before applying.')}</p>}
   {entry.summary && <p>{entry.summary}</p>}
   {mode === 'edit' ? <div className="note-change-edit">
    <label>{t('标题', 'Title')}<input value={entry.after.title || ''} disabled={!editable} onChange={event => edit({ title: event.target.value })} /></label>
    <label>{t('标签（逗号分隔）', 'Tags (comma-separated)')}<input defaultValue={(entry.after.tags || []).join(', ')} disabled={!editable} onBlur={event => edit({ tags: event.target.value.split(/[,，]/).map(value => value.trim()).filter(Boolean) })} /></label>
    <label>{t('建议正文（不会自动保存到笔记）', 'Draft content (separate from the saved note)')}<textarea value={entry.after.content || ''} disabled={!editable} onChange={event => edit({ content: event.target.value })} /></label>
   </div> : mode === 'original' ? <><h3>{entry.before?.title || t('新建笔记', 'New note')}</h3><pre>{entry.before?.content || ''}</pre></> : <>
    {entry.before?.title !== entry.after.title && <p>{t('标题', 'Title')}: <del>{entry.before?.title || '—'}</del> → <ins>{entry.after.title}</ins></p>}
    {(entry.before?.notebookId !== entry.after.notebookId || entry.before?.notebook !== entry.after.notebook) && <p>{t('分类', 'Notebook')}: <del>{entry.before?.notebook || entry.before?.notebookId || '—'}</del> → <ins>{entry.after.notebook || entry.after.notebookId || '—'}</ins></p>}
    {!!entry.before?.pinned !== !!entry.after.pinned && <p>{t('置顶', 'Pinned')}: <del>{entry.before?.pinned ? t('是', 'Yes') : t('否', 'No')}</del> → <ins>{entry.after.pinned ? t('是', 'Yes') : t('否', 'No')}</ins></p>}
    {JSON.stringify(entry.before?.tags || []) !== JSON.stringify(entry.after.tags || []) && <p>{t('标签', 'Tags')}: <del>{(entry.before?.tags || []).join(', ') || '—'}</del> → <ins>{(entry.after.tags || []).join(', ') || '—'}</ins></p>}
    {lines.length > 4000 && <p>{t('差异仅展示前 4000 行，编辑建议稿可查看完整正文。', 'Showing first 4000 diff lines. Edit draft shows all content.')}</p>}
    <pre className="note-change-diff">{lines.slice(0, 4000).map((line, index) => <span className={'change-' + line.kind} key={index}><b aria-hidden="true">{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}</b>{line.text || ' '}</span>)}</pre>
   </>}
  </div>
  <footer>
   {(error || entry.error || warning) && <p role="alert" className="plugin-error">{error || entry.error || warning}</p>}
   {entry.state === 'applied' && !entry.before && <p>{t('新建笔记可从笔记菜单移入回收站。', 'Move a new note to trash from the note menu if needed.')}</p>}
   <div className="plugin-actions">{entry.state === 'pending' && <><button disabled={entry.busy} onClick={() => { setError('');setConfirmation('discard') }}>{t('丢弃', 'Discard')}</button><button className="note-change-primary" disabled={entry.busy} onClick={() => void run(() => noteChanges.apply(entry.id))}>{entry.busy ? t('正在保存…', 'Saving…') : t('应用修改', 'Apply changes')}</button></>}
    {entry.state === 'applied' && entry.before && <button disabled={entry.busy} onClick={() => void run(() => noteChanges.undo(entry.pluginId, entry.id))}>{entry.busy ? t('正在撤回…', 'Undoing…') : t('撤回此次修改', 'Undo this change')}</button>}
   </div>
  </footer>
  {confirmation && entry.state === 'pending' && createPortal(<div className="plugin-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !entry.busy) setConfirmation(null) }}>
   <div className="plugin-dialog note-change-confirm" role="dialog" aria-modal={true} aria-label={confirmation === 'minimize' ? t('建议稿尚未应用', 'Unapplied draft') : t('丢弃建议稿', 'Discard draft')} tabIndex={-1} ref={dialog}>
    <h3>{confirmation === 'minimize' ? t('AI 建议稿尚未应用到笔记，是否应用？', 'Apply the AI draft before minimizing?') : t('确认丢弃这份建议稿？', 'Discard this draft?')}</h3>
    <p>{confirmation === 'minimize' ? t('应用后保存到笔记；也可以保留建议稿，稍后继续审阅。', 'Apply to save the note, or retain the draft for later review.') : t('丢弃后不会修改原笔记，此建议稿将无法继续应用。', 'The original note stays unchanged. This draft can no longer be applied.')}</p>
    {(error || entry.error || warning) && <p role="alert" className="plugin-error">{error || entry.error || warning}</p>}
    <div className="plugin-actions">
     <button disabled={entry.busy} onClick={() => setConfirmation(null)}>{t('继续审阅', 'Continue reviewing')}</button>
     {confirmation === 'minimize' ? <>
      <button disabled={entry.busy} onClick={() => void run(async () => { noteChanges.retain(entry.id);setConfirmation(null) })}>{t('保留建议稿并收起', 'Keep draft and minimize')}</button>
      <button className="note-change-primary" disabled={entry.busy} onClick={() => void run(() => noteChanges.applyAndClose(entry.id))}>{entry.busy ? t('正在保存…', 'Saving…') : t('应用并收起', 'Apply and minimize')}</button>
     </> : <button disabled={entry.busy} onClick={() => { noteChanges.discard(entry.id);setConfirmation(null) }}>{t('确认丢弃', 'Discard draft')}</button>}
    </div>
   </div>
  </div>, document.body)}
 </section>
}
