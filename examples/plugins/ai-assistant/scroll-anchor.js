export function captureMessageAnchor(log) {
 const children=[...log.children],top=log.getBoundingClientRect?.().top;
 const index=children.findIndex(node=>node.getBoundingClientRect?.().bottom>top);
 return {index,offset:index<0?0:children[index].getBoundingClientRect().top-top,top:log.scrollTop,height:log.scrollHeight};
}
export function restoreMessageAnchor(log,anchor,inserted) {
 const node=anchor.index<0?null:log.children[anchor.index+inserted];
 if(node?.getBoundingClientRect)log.scrollTop+=node.getBoundingClientRect().top-log.getBoundingClientRect().top-anchor.offset;
 else log.scrollTop=anchor.top+(log.scrollHeight-anchor.height);
}
