import {parseMarkdown,walk,type AstNode} from './markdown.ts'

type Segment={text:string;sourceStart?:number}
type Part={segments:Segment[];marked:boolean}
const offset=(node:AstNode)=>node.position!.start.offset!
const end=(node:AstNode)=>node.position!.end.offset!

/** Change inline emphasis in each AST paragraph, keeping source syntax and citation keys. */
export function toggleInlineFormat(text:string,range:{start:number;end:number},kind:'bold'|'italic'){
  const tree=parseMarkdown(text),type=kind==='bold'?'strong':'emphasis',token=kind==='bold'?'**':'*'
  let selected=0,marked=0
  const inspect=(node:AstNode,active=false)=>{
    active=active||node.type===type
    if(node.type==='text'){
      const from=Math.max(range.start,offset(node)),to=Math.min(range.end,end(node))
      if(from<to&&text.slice(from,to).trim()){selected++;if(active)marked++}
    }
    for(const child of node.children??[])inspect(child,active)
  }
  inspect(tree)
  if(!selected)return {text,range,changes:[]}
  const enable=marked!==selected
  const raw=(start:number,to:number):Segment=>({text:text.slice(start,to),sourceStart:start})
  const value=(part:Part)=>part.segments.map(row=>row.text).join('')
  const render=(parts:Part[]):Segment[]=>{
    const runs:Part[]=[]
    for(const part of parts){const previous=runs.at(-1);if(previous?.marked===part.marked)previous.segments.push(...part.segments);else runs.push({marked:part.marked,segments:[...part.segments]})}
    return runs.flatMap(part=>{
      if(!part.marked||!value(part).trim())return part.segments
      // Delimiters cannot touch whitespace on their inside edge.
      const segments=[...part.segments],before:Segment[]=[],after:Segment[]=[]
      while(segments.length){const first=segments[0],space=/^\s+/u.exec(first.text)?.[0];if(!space)break
        before.push({...first,text:space});if(space.length===first.text.length)segments.shift();else{segments[0]={...first,text:first.text.slice(space.length),sourceStart:first.sourceStart===undefined?undefined:first.sourceStart+space.length};break}}
      while(segments.length){const last=segments.at(-1)!,space=/\s+$/u.exec(last.text)?.[0];if(!space)break
        after.unshift({...last,text:space,sourceStart:last.sourceStart===undefined?undefined:last.sourceStart+last.text.length-space.length});if(space.length===last.text.length)segments.pop();else{segments[segments.length-1]={...last,text:last.text.slice(0,-space.length)};break}}
      return [...before,{text:token},...segments,{text:token},...after]
    })
  }
  const transform=(node:AstNode,inherited=false):Part[]=>{
    const start=offset(node),to=end(node)
    if(node.type==='text'){
      const edges=[...new Set([start,to,Math.max(start,Math.min(to,range.start)),Math.max(start,Math.min(to,range.end))])].sort((a,b)=>a-b)
      return edges.slice(0,-1).map((from,index)=>({segments:[raw(from,edges[index+1])],marked:from>=range.start&&edges[index+1]<=range.end?enable:inherited}))
    }
    if(!node.children?.length)return [{segments:[raw(start,to)],marked:inherited}]
    const parts=node.children.flatMap(child=>transform(child,inherited||node.type===type))
    if(node.type===type||['paragraph','heading'].includes(node.type))return parts
    const meaningful=parts.filter(part=>value(part).trim()),uniform=meaningful.every(part=>part.marked===meaningful[0]?.marked)
    // Links keep emphasis inside their label: a closing delimiter after ")" can be literal
    // when the next character is a word. Promoting a link would break that inline boundary.
    const promote=uniform&&['emphasis','strong'].includes(node.type)
    const inside=promote?parts.flatMap(part=>part.segments):render(parts)
    return [{segments:[raw(start,offset(node.children[0])),...inside,raw(end(node.children.at(-1)!),to)],marked:promote&&!!meaningful[0]?.marked}]
  }
  const blocks:AstNode[]=[]
  walk(tree,node=>{if(['paragraph','heading'].includes(node.type)&&offset(node)<range.end&&end(node)>range.start)blocks.push(node)})
  const segments:Segment[]=[],changes:Array<{startUtf16:number;endUtf16:number;replacementText:string}>=[]
  let cursor=0
  for(const block of blocks){
    const children=block.children!,start=offset(children[0]),to=end(children.at(-1)!)
    const replacement=render(children.flatMap(node=>transform(node)))
    segments.push(raw(cursor,start),...replacement);cursor=to
  }
  segments.push(raw(cursor,text.length))
  let originalOffset=0,inserted=''
  for(const segment of segments){
    if(segment.sourceStart===undefined){inserted+=segment.text;continue}
    if(inserted||segment.sourceStart>originalOffset)changes.push({startUtf16:originalOffset,endUtf16:segment.sourceStart,replacementText:inserted})
    inserted='';originalOffset=segment.sourceStart+segment.text.length
  }
  if(inserted||originalOffset<text.length)changes.push({startUtf16:originalOffset,endUtf16:text.length,replacementText:inserted})
  let nextOffset=0,nextStart:number|undefined,nextEnd:number|undefined
  for(const segment of segments){
    if(segment.sourceStart!==undefined){const start=segment.sourceStart,to=start+segment.text.length
      if(nextStart===undefined&&to>range.start)nextStart=nextOffset+Math.max(0,range.start-start)
      if(start<range.end)nextEnd=nextOffset+Math.min(segment.text.length,range.end-start)
    }
    nextOffset+=segment.text.length
  }
  return {text:segments.map(row=>row.text).join(''),range:{start:nextStart!,end:nextEnd!},changes}
}
