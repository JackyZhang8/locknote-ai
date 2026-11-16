import { compare } from './diff'
self.onmessage=(event:MessageEvent<{a:string;b:string}>)=>{try{self.postMessage({result:compare(event.data.a,event.data.b)})}catch{self.postMessage({error:'无法计算差异 / Unable to compute differences'})}}
