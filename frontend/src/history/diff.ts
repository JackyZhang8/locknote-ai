export type Part = { text: string; changed: boolean }
export type Row = { id: number; left: string | null; right: string | null; oldLine: number | null; newLine: number | null; kind: 'same' | 'add' | 'remove' | 'change'; leftParts?: Part[]; rightParts?: Part[]; folded?: number }
export type Comparison = { rows: Row[]; changes: number[]; added: number; removed: number; coarse: boolean }
export type Line = { kind: 'same' | 'add' | 'remove'; text: string }
function sequence(a: string[], b: string[], limit: number, depth = 0): { lines: Line[]; coarse: boolean } {
 const lines: Line[] = [];let prefix=0, endA=a.length, endB=b.length
 while(prefix<endA && prefix<endB && a[prefix]===b[prefix]) { lines.push({kind:'same',text:a[prefix]});prefix++ }
 while(endA>prefix && endB>prefix && a[endA-1]===b[endB-1]) {endA--;endB--}
 const n=endA-prefix,m=endB-prefix,overBudget=(n+1)*(m+1)>limit;let coarse=false
 if(!overBudget) {
  const table=Array.from({length:n+1},()=>new Uint32Array(m+1))
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)table[i][j]=a[prefix+i]===b[prefix+j]?table[i+1][j+1]+1:Math.max(table[i+1][j],table[i][j+1])
  let i=0,j=0;while(i<n || j<m) {
   if(i<n && j<m && a[prefix+i]===b[prefix+j]) {lines.push({kind:'same',text:a[prefix+i]});i++;j++}
   else if(j<m && (i===n || table[i][j+1]>=table[i+1][j]))lines.push({kind:'add',text:b[prefix+j++]})
   else lines.push({kind:'remove',text:a[prefix+i++]})
  }
 }else {
  const positionsA=new Map<string,number>(),positionsB=new Map<string,number>()
  for(let i=prefix;i<endA;i++)positionsA.set(a[i],positionsA.has(a[i])?-1:i)
  for(let j=prefix;j<endB;j++)positionsB.set(b[j],positionsB.has(b[j])?-1:j)
  const pairs:Array<[number,number]>=[]
  for(let i=prefix;i<endA;i++){const j=positionsB.get(a[i]);if(positionsA.get(a[i])===i&&j!==undefined&&j>=0)pairs.push([i,j])}
  const tails:number[]=[],tailIndices:number[]=[],previous=new Int32Array(pairs.length).fill(-1)
  for(let i=0;i<pairs.length;i++){let low=0,high=tails.length;while(low<high){const mid=(low+high)>>1;if(tails[mid]<pairs[i][1])low=mid+1;else high=mid}previous[i]=low?tailIndices[low-1]:-1;tails[low]=pairs[i][1];tailIndices[low]=i}
  const anchors:Array<[number,number]>=[];let index=tailIndices[tails.length-1]??-1
  while(index>=0){anchors.push(pairs[index]);index=previous[index]}anchors.reverse()
  if(anchors.length&&depth<16){
   let ai=prefix,bi=prefix
   for(const [i,j] of [...anchors,[endA,endB] as [number,number]]){
    if(i>ai||j>bi){const part=sequence(a.slice(ai,i),b.slice(bi,j),limit,depth+1);for(const line of part.lines)lines.push(line);coarse ||= part.coarse}
    if(i<endA)lines.push({kind:'same',text:a[i]});ai=i+1;bi=j+1
   }
  }else{coarse=true;for(let i=prefix;i<endA;i++)lines.push({kind:'remove',text:a[i]});for(let j=prefix;j<endB;j++)lines.push({kind:'add',text:b[j]})}
 }
 for(let i=endA;i<a.length;i++)lines.push({kind:'same',text:a[i]})
 return {lines,coarse}
}
export function diffLines(before: string,after: string): Line[] {return sequence(before.split('\n'),after.split('\n'),300000).lines}
export function inlineDiff(a: string,b: string): {left:Part[];right:Part[]} {
 const tokens=(text:string)=>text.match(/[A-Za-z0-9_]+|\s+|[^\s]/gu)||[]
 const diff=sequence(tokens(a),tokens(b),30000),left:Part[]=[],right:Part[]=[]
 for(const line of diff.lines) {if(line.kind!=='add')left.push({text:line.text,changed:line.kind==='remove'});if(line.kind!=='remove')right.push({text:line.text,changed:line.kind==='add'})}
 return {left,right}
}
export function compare(a:string,b:string):Comparison {
 const {lines,coarse}=sequence(a.split('\n'),b.split('\n'),600000),rows:Row[]=[],changes:number[]=[]
 let oldLine=1,newLine=1,added=0,removed=0,detailBudget=200000
 for(let i=0;i<lines.length;) {
  if(lines[i].kind==='same') {rows.push({id:rows.length,left:lines[i].text,right:lines[i].text,oldLine:oldLine++,newLine:newLine++,kind:'same'});i++;continue}
  changes.push(rows.length);const old:string[]=[],next:string[]=[]
  while(i<lines.length && lines[i].kind!=='same') {const line=lines[i++];if(line.kind==='remove')old.push(line.text);else next.push(line.text)}
  added+=next.length;removed+=old.length
  for(let j=0;j<Math.max(old.length,next.length);j++) {
   const left=old[j]??null,right=next[j]??null,row:Row={id:rows.length,left,right,oldLine:left===null?null:oldLine++,newLine:right===null?null:newLine++,kind:left===null?'add':right===null?'remove':'change'}
   if(left!==null && right!==null && detailBudget>0 && left.length+right.length<12000) {detailBudget-=left.length+right.length;const parts=inlineDiff(left,right);row.leftParts=parts.left;row.rightParts=parts.right}
   rows.push(row)
  }
 }
 return {rows,changes,added,removed,coarse}
}
export function foldRows(rows:Row[],context=3):Row[] {
 const result:Row[]=[]
 for(let i=0;i<rows.length;) {
  if(rows[i].kind!=='same') {result.push(rows[i++]);continue}
  let end=i;while(end<rows.length && rows[end].kind==='same')end++
  const head=i===0?0:context,tail=end===rows.length?0:context
  if(end-i<=head+tail+2)result.push(...rows.slice(i,end))
  else {result.push(...rows.slice(i,i+head));result.push({...rows[i+head],left:'',right:'',folded:end-i-head-tail});result.push(...rows.slice(end-tail,end))}
  i=end
 }return result
}
