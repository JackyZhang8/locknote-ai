import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Part, Row } from './diff'
import { offsetsFor, rowAt, captureAnchor, restoreAnchor } from './layout'
import { t } from '../plugins/ui-text'
interface Props { rows:Row[];unified:boolean;sync:boolean;wrap:boolean;target:number;navigationKey?:number;onExpand():void }
export function ComparePanes({rows,unified,sync,wrap,target,navigationKey=0,onExpand}:Props){
 const refs=[useRef<HTMLDivElement>(null),useRef<HTMLDivElement>(null)],root=useRef<HTMLDivElement>(null)
 const [tops,setTops]=useState([0,0]),[viewport,setViewport]=useState(600),[revision,setRevision]=useState(0),[width,setWidth]=useState(0)
 const heights=useRef(new Map<number,number>()),natural=useRef(new Map<string,number>()),frame=useRef(0),guard=useRef(["",""])
 const previous=useRef<{rows:Row[];offsets:number[]}|null>(null),anchors=useRef<ReturnType<typeof captureAnchor>[]>([null,null]),navigation=useRef(-1)
 const geometry=useRef({rows,wrap,unified,width})
 const changed=geometry.current.rows!==rows||geometry.current.wrap!==wrap||geometry.current.unified!==unified||geometry.current.width!==width
 if(changed){
  if(previous.current)anchors.current=refs.map((ref,side)=>captureAnchor(previous.current!.rows,previous.current!.offsets,ref.current?.scrollTop??tops[side]))
  heights.current.clear();natural.current.clear();geometry.current={rows,wrap,unified,width}
 }
 useEffect(()=>{const element=root.current;if(!element)return;const observer=new ResizeObserver(()=>{setViewport(element.clientHeight);setWidth(element.clientWidth)});observer.observe(element);return()=>observer.disconnect()},[])
 const offsets=useMemo(()=>offsetsFor(rows.map(row=>row.id),heights.current,28),[rows,revision,unified,width,wrap])
 const indexAt=(position:number)=>rowAt(offsets,position)
 const windows=[0,1].map(side=>{const start=Math.max(0,indexAt(tops[side])-10),end=Math.min(rows.length,indexAt(tops[side]+viewport)+15);return {start,end}})
 useLayoutEffect(()=>{
  const old=previous.current
  if(!changed&&old&&old.offsets!==offsets)anchors.current=refs.map((ref,side)=>captureAnchor(old.rows,old.offsets,ref.current?.scrollTop??tops[side]))
  const next=refs.map((ref,side)=>{
   const destination=navigation.current>=0?restoreAnchor(rows,offsets,{id:navigation.current,offset:0}):restoreAnchor(rows,offsets,anchors.current[side])
   const top=navigation.current>=0?Math.max(0,destination-30):destination
   if(ref.current){ref.current.scrollTop=top;guard.current[side]=ref.current.scrollTop+':'+ref.current.scrollLeft;return ref.current.scrollTop}return top
  })
  previous.current={rows,offsets};if(old?.offsets!==offsets||changed)setTops(next)
 },[rows,offsets,width,wrap,unified])
 useLayoutEffect(()=>{
  const element=root.current;if(!element)return
  const measure=()=>{let changed=false;const measured=new Set<number>();for(const node of element.querySelectorAll<HTMLElement>('[data-natural]')){const id=Number(node.dataset.row),side=node.dataset.side!;natural.current.set(id+':'+side,node.getBoundingClientRect().height);measured.add(id)}
   for(const id of measured){const value=Math.ceil(Math.max(natural.current.get(id+':0')||0,natural.current.get(id+':1')||0,28));if(heights.current.get(id)!==value){heights.current.set(id,value);changed=true}}
   if(changed){cancelAnimationFrame(frame.current);frame.current=requestAnimationFrame(()=>setRevision(v=>v+1))}
  }
  measure();const observer=new ResizeObserver(measure);element.querySelectorAll('[data-natural]').forEach(node=>observer.observe(node));return()=>{observer.disconnect();cancelAnimationFrame(frame.current)}
 },[rows,windows[0].start,windows[0].end,windows[1].start,windows[1].end,width,wrap,unified])
 useLayoutEffect(()=>{if(target<0)return;navigation.current=target;const top=Math.max(0,restoreAnchor(rows,offsets,{id:target,offset:0})-30);const next=refs.map((ref,side)=>{if(ref.current){ref.current.scrollTop=top;guard.current[side]=ref.current.scrollTop+':'+ref.current.scrollLeft;return ref.current.scrollTop}return top});setTops(next)},[target,navigationKey])
 const scroll=(side:number)=>{const node=refs[side].current;if(!node)return;const position=node.scrollTop+':'+node.scrollLeft;setTops(values=>values.map((value,i)=>i===side?node.scrollTop:value));if(guard.current[side]===position){guard.current[side]='';return}navigation.current=-1;anchors.current[side]=captureAnchor(rows,offsets,node.scrollTop);if(sync){const other=refs[1-side].current;if(other){other.scrollTop=node.scrollTop;if(!wrap)other.scrollLeft=node.scrollLeft;guard.current[1-side]=other.scrollTop+':'+other.scrollLeft;anchors.current[1-side]=anchors.current[side];setTops([node.scrollTop,other.scrollTop])}}}
 const parts=(value:Part[]|undefined,text:string|null)=>(value||[{text:text||' ',changed:false}]).map((part,i)=><mark className={part.changed?'changed':''} key={i}>{part.text}</mark>)
 const cell=(row:Row,side:number)=>{if(row.folded)return <button onClick={onExpand}>{t('展开未变化的','Expand unchanged')} {row.folded} {t('行','lines')}</button>
  const text=side===0?row.left:row.right,line=side===0?row.oldLine:row.newLine
  return <><span className="history-line-number">{line??''}</span><span className="history-line-sign" aria-hidden="true">{row.kind==='same'?' ':text===null?'':side===0?'−':'+'}</span><code>{parts(side===0?row.leftParts:row.rightParts,text)}</code></>
 }
 return <div ref={root} className={'history-panes'+(unified?' unified':'')+(wrap?' wrap':' nowrap')}>
  {(unified?[0]:[0,1]).map(side=>{const {start,end}=windows[side];return <div className="history-scroll" ref={refs[side]} key={side} tabIndex={0} aria-label={side===0?t('旧版本内容','Old version content'):t('新版本内容','New version content')} onScroll={()=>scroll(side)}><div className="history-virtual" style={{height:offsets[offsets.length-1]}}><div style={{position:'absolute',top:offsets[start],left:0,minWidth:'100%',width:wrap?'100%':undefined}}>{rows.slice(start,end).map(row=><div key={row.id} data-change={row.id===target||undefined} className={'history-row '+row.kind+(row.folded?' folded':'')} style={{height:heights.current.get(row.id)||28}}><div data-natural data-row={row.id} data-side={side} className="history-natural">{unified&&row.kind==='change'?<><div className="remove">{cell(row,0)}</div><div className="add">{cell(row,1)}</div></>:cell(row,unified&&row.kind==='add'?1:side)}</div></div>)}</div></div></div>})}
 </div>
}
