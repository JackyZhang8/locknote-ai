export function createJournal(api) {
 let current=null,queue=Promise.resolve(),blocked=false,before=0;
 const messages=events=>events.filter(e=>e.type==='message'&&['user','assistant'].includes(e.role)&&typeof e.content==='string').map(e=>({role:e.role,content:e.content}));
 return {
  get current(){return current},get before(){return before},
  async initialize(){try {const list=await api.list();return list.activeId?await this.open(list.activeId):{messages:[],checkpoint:null}} catch(error){blocked=true;throw error}},
  async open(id){await queue.catch(()=>{});const page=await api.read(id);await api.activate(id);current={id:page.id,seq:page.seq,title:page.title};blocked=false;before=page.before;
   const checkpoint=page.checkpoint?structuredClone(page.checkpoint):null;
   let recoveryEvents=page.events, cursor=page.before, pages=0;
   const collected=[];
   while(checkpoint&&cursor>checkpoint.seq){
    if(++pages>32)throw new Error('中断记录过长，请新建会话 / interrupted journal exceeds recovery budget');
    const older=await api.read(id,cursor);if(older.before>=cursor)throw new Error('Invalid history cursor');
    collected.unshift(...older.events);cursor=older.before;
   }
   recoveryEvents=[...collected,...recoveryEvents];
   const after=recoveryEvents.filter(e=>e.seq>(checkpoint?.seq||0));
   const interrupted=!!checkpoint?.interrupted||after.some(e=>e.type==='turn_start');
   if(checkpoint&&interrupted){
    if (!checkpoint.interrupted && after.some(e=>e.type==='turn_start')) { checkpoint.state.receipts=[];checkpoint.state.history.push({role:'user',content:after.find(e=>e.type==='message'&&e.role==='user')?.content || 'Interrupted before sending'}); }
    checkpoint.interrupted=true;checkpoint.state.receipts ||= [];for(const e of after)if(e.type==='tool'&&e.result?.saved)checkpoint.state.receipts.push({...e.result,type:e.name});}
   return {messages:messages(page.events),checkpoint,interrupted,recovered:page.recovered};
  },
  async create(title){await queue.catch(()=>{});const created=await api.create(title);current=created;blocked=false;before=0;return current},
  append(event){const operation=queue.then(async()=>{if(blocked)throw new Error('保存失败，请重新打开会话 / reopen conversation');if(!current)throw new Error('No active conversation');try{current={...current,...await api.append(current.id,current.seq,[event])}}catch(error){blocked=true;throw error}});queue=operation.catch(()=>{});return operation},
  async older(){if(!current||!before)return [];const page=await api.read(current.id,before);before=page.before;return messages(page.events)},
  async list(offset=0){return api.list(offset)},
  async rename(id,title){await queue;await api.rename(id,title);if(current?.id===id){const page=await api.read(id);current={...current,seq:page.seq,title:page.title}}},
  async delete(id){await queue;await api.delete(id);if(current?.id===id){current=null;before=0;blocked=false}},
 };
}
