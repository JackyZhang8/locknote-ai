export interface HistoryNote { id:string;title:string;content:string;version:number;wordCount?:number }
export interface Revision {id:string;title:string;version:number;source:string;createdAt:string;words:number}
export interface HistoryHost {note:HistoryNote;request<T>(path:string,options?:{method?:string;body?:unknown;signal?:AbortSignal}):Promise<T>;restore(revisionId:string,expectedVersion:number):Promise<HistoryNote>;undo(before:HistoryNote,expectedVersion:number):Promise<HistoryNote>}
let host:HistoryHost|null=null
const subscribers=new Set<()=>void>()
export const historyStore={getSnapshot:()=>host,subscribe:(fn:()=>void)=>{subscribers.add(fn);return()=>{subscribers.delete(fn)}},open(value:HistoryHost){host=value;for(const fn of subscribers)fn()},close(){host=null;for(const fn of subscribers)fn()}}
declare global {interface Window {LNHistory?:{open:typeof historyStore.open;isOpen():boolean}}}
export function installHistory(){window.LNHistory={open:value=>historyStore.open(value),isOpen:()=>historyStore.getSnapshot()!==null}}
