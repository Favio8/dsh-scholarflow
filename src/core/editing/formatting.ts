import type { DocumentFormatting, CharacterFormat, ParagraphFormat } from '../../shared/formatting.ts'
import type {Leaf} from './markdown.ts'

export const emptyFormatting = (): DocumentFormatting => ({ characters: [], paragraphs: [] })
export function paragraphStyle(formatting: DocumentFormatting | undefined, start: number, end: number) {
  return formatting?.paragraphs.filter(row => row.start < end && row.end > start).reduce((style, row) => ({ ...style, ...row }), {} as Partial<ParagraphFormat>) ?? {}
}
export function formattedLeaf(leaf:Leaf,formatting?:DocumentFormatting){
  const rows=(formatting?.characters??[]).flatMap(row=>{const units=leaf.units.filter(unit=>unit.sourceStart<row.end&&unit.sourceEnd>row.start);return units.length?[{...row,from:units[0].renderedStart,to:units.at(-1)!.renderedEnd}]:[]})
  const edges=[...new Set([0,leaf.text.length,...rows.flatMap(row=>[row.from,row.to])])].sort((a,b)=>a-b)
  return edges.slice(0,-1).map((from,index)=>({from,to:edges[index+1],text:leaf.text.slice(from,edges[index+1]),style:rows.filter(row=>row.from<=from&&row.to>from).reduce((style,row)=>({...style,...row}),{} as Partial<CharacterFormat>)}))
}

/** Keep formatting attached to text as edits shift, replace or extend its range. */
export function rebaseFormatting(formatting: DocumentFormatting | undefined, before: string, after: string,
  changes?: Array<{startUtf16:number;endUtf16:number;replacementText:string}>): DocumentFormatting {
  if (!formatting) return emptyFormatting()
  if (before === after) return structuredClone(formatting)
  if (!changes) {
    let start=0, end=before.length, nextEnd=after.length
    while(start<end && start<nextEnd && before[start]===after[start])start++
    while(end>start && nextEnd>start && before[end-1]===after[nextEnd-1]){end--;nextEnd--}
    changes=[{startUtf16:start,endUtf16:end,replacementText:after.slice(start,nextEnd)}]
  }
  let result=structuredClone(formatting)
  for(const edit of [...changes].sort((a,b)=>b.startUtf16-a.startUtf16)){
    const delta=edit.replacementText.length-(edit.endUtf16-edit.startUtf16),newEnd=edit.startUtf16+edit.replacementText.length
    const shift=<T extends {start:number;end:number}>(row:T):T => {
      if(edit.endUtf16<=row.start)return {...row,start:row.start+delta,end:row.end+delta}
      if(edit.startUtf16>=row.end)return row
      return {...row,start:Math.min(row.start,edit.startUtf16),end:row.end>=edit.endUtf16?row.end+delta:newEnd}
    }
    result={characters:result.characters.map(shift).filter(row=>row.end>row.start),paragraphs:result.paragraphs.map(shift).filter(row=>row.end>row.start)}
  }
  return result
}
