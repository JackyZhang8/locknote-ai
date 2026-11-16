import test from 'node:test'
import assert from 'node:assert/strict'
import { compare, inlineDiff, foldRows } from './history/diff.js'
import { offsetsFor, rowAt, captureAnchor, restoreAnchor } from './history/layout.js'
test('aligned panes share offsets after wrapping and map exact row boundaries',()=>{
 const offsets=offsetsFor([1,2,3],new Map([[2,120]]));assert.deepEqual(offsets,[0,28,148,176]);assert.equal(rowAt(offsets,28),1);assert.equal(rowAt(offsets,147),1);assert.equal(rowAt(offsets,148),2)
 const many=offsetsFor(Array.from({length:100000},(_,i)=>i),new Map());assert.equal(rowAt(many,280000),10000)
})
test('comparison reconstructs repeated and disjoint changes exactly', () => {
 for (const [a,b] of [['a\nb\nc\nd\ne','a\nB\nc\nD\ne'],['x\nx\ny','x\ny\nx'],['','new'],['old',''],['same','same']]) {
  const result = compare(a,b)
  assert.equal(result.rows.filter(row=>row.left !== null).map(row=>row.left).join('\n'),a)
  assert.equal(result.rows.filter(row=>row.right !== null).map(row=>row.right).join('\n'),b)
 }
 assert.equal(compare('a\nb\nc\nd\ne','a\nB\nc\nD\ne').changes.length,2)
})
test('inline diff highlights only changed Chinese characters and English words', () => {
 const zh=inlineDiff('今天很好','今天非常好');assert.equal(zh.left.filter(x=>x.changed).map(x=>x.text).join(''),'很');assert.equal(zh.right.filter(x=>x.changed).map(x=>x.text).join(''),'非常')
 const en=inlineDiff('hello world','hello note');assert.equal(en.left.filter(x=>x.changed).map(x=>x.text).join(''),'world')
})
test('folding retains context and large changes have bounded detail work', () => {
 const a=Array.from({length:10000},(_,i)=>'line '+i), b=a.slice();b[5000]='changed'
 const diff=compare(a.join('\n'),b.join('\n'));assert.equal(diff.changes.length,1);assert.equal(foldRows(diff.rows,3).length<30,true)
 assert.equal(compare('x\n'.repeat(3000),'y\n'.repeat(3000)).rows.length>0,true)
})
test('randomized repeated lines always reconstruct both versions',()=>{
 let seed=17;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed%7}
 for(let i=0;i<150;i++){const a=Array.from({length:random()+3},()=>String(random())).join(String.fromCharCode(10)),b=Array.from({length:random()+3},()=>String(random())).join(String.fromCharCode(10)),result=compare(a,b);assert.equal(result.rows.filter(row=>row.left!==null).map(row=>row.left).join(String.fromCharCode(10)),a);assert.equal(result.rows.filter(row=>row.right!==null).map(row=>row.right).join(String.fromCharCode(10)),b)}
})
test('two distant edits in long notes stay two changes',()=>{
 const a=Array.from({length:2000},(_,i)=>'line '+i),b=a.slice();b[100]='Changed A';b[1800]='Changed B';const result=compare(a.join(String.fromCharCode(10)),b.join(String.fromCharCode(10)));assert.equal(result.added,2);assert.equal(result.removed,2);assert.equal(result.changes.length,2);assert.equal(result.coarse,false)
})
test('viewport anchors survive measured wraps and folded expansion',()=>{
 const rows=Array.from({length:1000},(_,id)=>({id})),old=offsetsFor(rows.map(r=>r.id),new Map()),anchor=captureAnchor(rows,old,old[900]+12)
 const measured=offsetsFor(rows.map(r=>r.id),new Map(Array.from({length:10},(_,i)=>[890+i,268])))
 assert.equal(restoreAnchor(rows,measured,anchor),measured[900]+12)
 const folded=[{id:0},{id:500,folded:400},{id:900},{id:901}],collapsed=offsetsFor(folded.map(r=>r.id),new Map())
 const preserved=captureAnchor(folded,collapsed,collapsed[2]+5);assert.equal(restoreAnchor(rows,old,preserved),old[900]+5)
 assert.equal(restoreAnchor(folded,collapsed,{id:700,offset:8}),collapsed[1]+8)
})
