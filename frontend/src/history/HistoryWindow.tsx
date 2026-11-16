import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { historyStore, type HistoryHost, type HistoryNote, type Revision } from './bridge'
import { foldRows, inlineDiff, type Comparison } from './diff'
import { ComparePanes } from './ComparePanes'
import { t } from '../plugins/ui-text'
import './history.css'
import { blockWorkspaceShortcut } from './keyboard'
let maximized=false
export function HistoryWindow(){const host=useSyncExternalStore(historyStore.subscribe,historyStore.getSnapshot,historyStore.getSnapshot);return host?<HistoryDialog key={host.note.id} host={host}/>:null}
function HistoryDialog({host}:{host:HistoryHost}){
 const [current,setCurrent]=useState(host.note),[revisions,setRevisions]=useState<Revision[]>([]),[left,setLeft]=useState(''),[right,setRight]=useState('current')
 const [result,setResult]=useState<Comparison|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [full,setFull]=useState(maximized),[rail,setRail]=useState(true),[sync,setSync]=useState(true),[wrap,setWrap]=useState(true),[fold,setFold]=useState(true),[unified,setUnified]=useState(window.innerWidth<900)
 const [selected,setSelected]=useState(-1),[target,setTarget]=useState(-1),[navigationKey,setNavigationKey]=useState(0),[confirm,setConfirm]=useState(false),[undo,setUndo]=useState<{before:HistoryNote;version:number}|null>(null)
 const dialog=useRef<HTMLDivElement>(null),cache=useRef(new Map<string,{title:string;content:string}>()),diffCache=useRef(new Map<string,Comparison>()),job=useRef(0)
 const action=useRef(false);const [titles,setTitles]=useState({left:'',right:''})
 useEffect(()=>{const media=window.matchMedia('(max-width: 899px)'),change=()=>setUnified(media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change)},[])
 const path='/notes/'+encodeURIComponent(current.id)
 const refresh=()=>host.request<{revisions:Revision[]}>(path+'/revisions').then(data=>{setRevisions(data.revisions||[]);return data.revisions||[]})
 useEffect(()=>{let alive=true;void refresh().then(items=>{if(alive){setLeft(items[0]?.id||'current');setLoading(false)}}).catch(reason=>{if(alive){setError(String(reason.message||reason));setLoading(false)}});return()=>{alive=false}},[])
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;if(!dialog.current?.contains(previous))dialog.current?.focus()
  const keys=(event:KeyboardEvent)=>{if(blockWorkspaceShortcut(event)){event.preventDefault();event.stopImmediatePropagation();return}if(event.key==='Escape'&&!busy){event.preventDefault();event.stopImmediatePropagation();historyStore.close()}if(event.key==='Tab'){const items=dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select,input,[tabindex="0"]');if(!items?.length)return;const first=items[0],last=items[items.length-1];if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}}
  document.addEventListener('keydown',keys,true);return()=>{document.removeEventListener('keydown',keys,true);previous?.focus()}
 },[busy])
 useEffect(()=>{
  if(!left)return;const controller=new AbortController(),ticket=++job.current;let worker:Worker|undefined,alive=true;setLoading(true);setError('');setConfirm(false);setResult(null)
  const get=async(id:string)=>{if(id==='current')return current;const cached=cache.current.get(id);if(cached)return cached;const data=await host.request<{revision:Revision;content:string}>(path+'/revisions/'+encodeURIComponent(id),{signal:controller.signal});const value={title:data.revision.title,content:data.content};cache.current.set(id,value);if(cache.current.size>6)cache.current.delete(cache.current.keys().next().value!);return value}
  void Promise.all([get(left),get(right)]).then(([a,b])=>{
   if(!alive||ticket!==job.current)return;setTitles({left:a.title,right:b.title});const key=left+':'+right+':'+current.version,cached=diffCache.current.get(key)
   const finish=(data:Comparison)=>{if(!alive||ticket!==job.current)return;setResult(data);setLoading(false);setSelected(-1);setTarget(-1);diffCache.current.set(key,data);if(diffCache.current.size>3)diffCache.current.delete(diffCache.current.keys().next().value!)}
   if(cached){finish(cached);return}
   worker=new Worker(new URL('./diff.worker.ts',import.meta.url),{type:'module'});worker.onmessage=event=>{if(!alive)return;if(event.data.error){setError(event.data.error);setLoading(false)}else finish(event.data.result);worker?.terminate()};worker.onerror=()=>{if(alive){setError(t('差异计算失败，请重新选择版本。','Comparison failed. Select the versions again.'));setLoading(false)}worker?.terminate()};worker.postMessage({a:a.content,b:b.content})
  }).catch(reason=>{if(alive){setError(String(reason.message||reason));setLoading(false)}})
  return()=>{alive=false;controller.abort();worker?.terminate()}
 },[left,right,current.version])
 const titleParts=useMemo(()=>inlineDiff(titles.left,titles.right),[titles])
 const rows=useMemo(()=>result?(fold?foldRows(result.rows):result.rows):[],[result,fold])
 const change=(direction:number)=>{if(!result?.changes.length)return;const next=selected<0?(direction>0?0:result.changes.length-1):(selected+direction+result.changes.length)%result.changes.length;setSelected(next);setTarget(result.changes[next]);setNavigationKey(value=>value+1)}
 const restore=async()=>{if(!left||left==='current'||action.current)return;action.current=true;setBusy(true);setError('');try{const before={...current},saved=await host.restore(left,current.version);setCurrent(saved);setUndo({before,version:saved.version});setNotice(t('已恢复；恢复前内容已保留为历史版本。','Restored. Previous content retained in history.'));setConfirm(false);await refresh()}catch(reason){setError(String((reason as Error).message||reason))}finally{action.current=false;setBusy(false)}}
 const undoRestore=async()=>{if(!undo||action.current)return;action.current=true;setBusy(true);setError('');try{const saved=await host.undo(undo.before,undo.version);setCurrent(saved);setUndo(null);setNotice(t('已撤销此次恢复。','Restoration undone.'));await refresh()}catch(reason){setError(String((reason as Error).message||reason))}finally{action.current=false;setBusy(false)}}
 const label=(id:string)=>id==='current'?t('当前版本','Current')+' v'+current.version:(()=>{const r=revisions.find(item=>item.id===id);return r?'v'+r.version+' · '+new Date(r.createdAt).toLocaleString():id})()
 const selector=(value:string,onChange:(id:string)=>void,name:string)=><label>{name}<select value={value} disabled={busy} onChange={event=>onChange(event.target.value)}><option value="current">{label('current')}</option>{revisions.map(r=><option key={r.id} value={r.id}>{label(r.id)}</option>)}</select></label>
 return <div className="history-overlay"><div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="history-heading" tabIndex={-1} className={'history-window'+(full?' maximized':'')}>
  <header><h2 id="history-heading">{t('历史版本对比','Version history')} · {current.title}</h2><button onClick={()=>setRail(!rail)}>{t('版本列表','Versions')}</button><button onClick={()=>{maximized=!full;setFull(!full)}}>{full?t('还原窗口','Restore size'):t('最大化','Maximize')}</button><button disabled={busy} onClick={()=>historyStore.close()} aria-label={t('关闭','Close')}>×</button></header>
  <div className="history-content">{rail&&<aside aria-label={t('历史版本','Revisions')}>{!revisions.length&&<p>{t('尚无历史版本','No revisions yet')}</p>}{revisions.map(r=><button key={r.id} className={left===r.id?'selected':''} disabled={busy} onClick={()=>setLeft(r.id)}><b>v{r.version} · {r.words} {t('字','words')}</b><span>{new Date(r.createdAt).toLocaleString()}</span><small>{r.source==='web'?t('手动编辑','Manual edit'):r.source.startsWith('plugin:')?t('插件','Plugin')+': '+r.source.slice(7):r.source||t('未知来源','Unknown source')}</small></button>)}</aside>}
   <main><div className="history-toolbar">{selector(left,setLeft,t('左侧 / 旧','Left / Old'))}{selector(right,setRight,t('右侧 / 新','Right / New'))}<button disabled={busy} onClick={()=>{setLeft(right);setRight(left)}}>⇄</button></div>
    <div className="history-toolbar"><button aria-pressed={unified} onClick={()=>setUnified(!unified)}>{unified?t('合并差异','Unified'):t('左右并排','Side by side')}</button><label><input type="checkbox" checked={sync} onChange={e=>setSync(e.target.checked)}/>{t('同步滚动','Sync scroll')}</label><label><input type="checkbox" checked={wrap} onChange={e=>setWrap(e.target.checked)}/>{t('自动换行','Wrap')}</label><label><input type="checkbox" checked={fold} onChange={e=>setFold(e.target.checked)}/>{t('折叠未改','Fold unchanged')}</label><button title={t('上一处变化','Previous change')} disabled={!result?.changes.length} onClick={()=>change(-1)}>↑</button><button title={t('下一处变化','Next change')} disabled={!result?.changes.length} onClick={()=>change(1)}>↓</button><span>{result?.changes.length?(Math.max(0,selected)+1)+' / '+result.changes.length:'0 / 0'} · +{result?.added||0} / −{result?.removed||0}</span></div>
    {titles.left!==titles.right&&<div className="history-title-diff"><span>{t('标题变化','Title change')}: </span><del>{titleParts.left.map((part,i)=><mark key={i} className={part.changed?'changed':''}>{part.text}</mark>)}</del> → <ins>{titleParts.right.map((part,i)=><mark key={i} className={part.changed?'changed':''}>{part.text}</mark>)}</ins></div>}
    <div className="history-legend"><span>+ {t('新增','Added')}</span><span>− {t('删除','Removed')}</span><span>{t('深色标记：行内变化','Stronger highlight: changed text')}</span></div>
    <div className="history-pane-head"><span>{label(left)} · {titles.left}</span>{!unified&&<span>{label(right)} · {titles.right}</span>}</div>
    {loading?<div className="history-loading" role="status">{t('正在计算差异…','Computing differences…')}</div>:<ComparePanes rows={rows} unified={unified} sync={sync} wrap={wrap} target={target} navigationKey={navigationKey} onExpand={()=>setFold(false)}/>}
    {result?.coarse&&<p className="history-hint">{t('大范围改写采用分段对比；局部细节可能合并显示。','Extensive rewrites use bounded comparison; nearby changes may be grouped.')}</p>}
   </main>
  </div>
  <footer>{(error||notice)&&<p role={error?'alert':'status'} className={error?'history-error':''}>{error||notice}</p>}<small>{t('只恢复标题和正文，标签及分类保持不变。','Restores title and content only; tags and notebook stay unchanged.')}</small><div>{undo&&<button disabled={busy} onClick={()=>void undoRestore()}>{t('撤销此次恢复','Undo restoration')}</button>}{confirm?<><span>{t('确认用左侧版本恢复当前笔记？','Restore the current note from the left version?')}</span><button disabled={busy} onClick={()=>setConfirm(false)}>{t('取消','Cancel')}</button><button disabled={busy} onClick={()=>void restore()}>{busy?t('正在恢复…','Restoring…'):t('确认恢复','Confirm restore')}</button></>:<button disabled={busy||loading||left==='current'||!left} onClick={()=>setConfirm(true)}>{t('恢复左侧版本','Restore left version')}</button>}</div></footer>
 </div></div>
}
