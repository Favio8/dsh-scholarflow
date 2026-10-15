import { parse } from 'csv-parse/sync'
import { Tokenizer,TokenType,type ParsedTokenInfo } from '@streamparser/json'
import { invariant } from '../../shared/errors.ts'
import type { ResultCell } from '../../shared/results.ts'

export const RESULT_MAX_BYTES=2*1024*1024,RESULT_MAX_RECORDS=10000
const pointer=(parts:Array<string|number>)=>parts.map(part=>'/'+String(part).replaceAll('~','~0').replaceAll('/','~1')).join('')
/** Positions are computed from the original bytes, before any numeric conversion. */
export function parseResultBytes(bytes:Uint8Array,path:string,recordsPointer='',signal?:AbortSignal){
  signal?.throwIfAborted();invariant(bytes.byteLength<=RESULT_MAX_BYTES,'RESULT_FILE_TOO_LARGE','结果文件超过 2 MiB，请选择更小的表。')
  const decoded=new TextDecoder('utf-8',{fatal:true}).decode(bytes),bom=bytes[0]===239&&bytes[1]===187&&bytes[2]===191?3:0
  const cells:ResultCell[]=[],format=path.toLowerCase().split('.').at(-1)
  const lineStarts=[0]
  for(let i=0;i<bytes.length;i++)if(bytes[i]===13||bytes[i]===10){if(bytes[i]===13&&bytes[i+1]===10)i++;lineStarts.push(i+1)}
  const lineAt=(offset:number)=>{let low=0,high=lineStarts.length;while(low<high){const mid=(low+high)>>>1;if(lineStarts[mid]<=offset)low=mid+1;else high=mid}return low}
  const rowLines=(start:number,end:number)=>{let last=bom+end;while(last>bom+start&&(bytes[last-1]===10||bytes[last-1]===13))last--;return `${lineAt(bom+start)}-${lineAt(Math.max(bom+start,last-1))}`}
  if(format==='csv'){
    const records=parse(decoded,{bom:true,info:true,raw:true,cast:false,skip_empty_lines:false,relax_column_count:false,max_record_size:65536}) as unknown as Array<{record:string[];raw:string;info:{lines:number;bytes:number}}>
    invariant(records.length>1&&records.length<=RESULT_MAX_RECORDS+1,'RESULT_RECORD_LIMIT','CSV 需要表头及结果行，最多 10000 条。')
    const headers=records[0].record
    invariant(headers.length<=100&&headers.every(header=>header.trim())&&new Set(headers).size===headers.length,'RESULT_FIELDS_INVALID','CSV 表头为空、重复或超过字段限额。')
    let previousByte=records[0].info.bytes
    records.slice(1).forEach((row,index)=>{signal?.throwIfAborted();row.record.forEach((value,col)=>cells.push({field:headers[col],raw:value,value,recordIndex:index,
      locator:{kind:'data',relativePath:path,rowRange:`lines:${rowLines(previousByte,row.info.bytes)};column:${col+1}`,metric:headers[col]}}));previousByte=row.info.bytes})
  }else if(format==='json'){
    const value=JSON.parse(decoded),parts=recordsPointer?recordsPointer.split('/').slice(1).map(part=>part.replaceAll('~1','/').replaceAll('~0','~')):[]
    invariant(!recordsPointer||recordsPointer.startsWith('/'),'RESULT_POINTER_INVALID','记录数组位置须为 JSON Pointer。')
    let records=value;for(const part of parts){invariant(records&&Object.hasOwn(records,part),'RESULT_POINTER_INVALID','指定记录位置不存在。');records=records[part]}
    if(!Array.isArray(records))records=[records]
    invariant(records.length>0&&records.length<=RESULT_MAX_RECORDS&&records.every((record:any)=>record&&typeof record==='object'&&!Array.isArray(record)),'RESULT_RECORD_LIMIT','JSON 记录应为对象或对象数组，最多 10000 条。')
    const arrayRecords=Array.isArray(parts.length?parts.reduce((item:any,key)=>item[key],value):value)
    const tokenRows:ParsedTokenInfo[]=[],tokenizer=new Tokenizer();tokenizer.onToken=token=>tokenRows.push(token);tokenizer.write(Buffer.from(decoded));if(!tokenizer.isEnded)tokenizer.end()
    type Frame={path:Array<string|number>;type:'object'|'array';key?:string;index:number;expectKey:boolean;keys:Set<string>}
    const stack:Frame[]=[]
    const nextPath=()=>{const top=stack.at(-1);return top?[...top.path,top.type==='array'?top.index:top.key!]:[]}
    const complete=()=>{const top=stack.at(-1);if(top?.type==='array')top.index++;else if(top)top.expectKey=true}
    tokenRows.forEach((token,index)=>{signal?.throwIfAborted();const top=stack.at(-1)
      if(token.token===TokenType.COMMA||token.token===TokenType.COLON)return
      if(token.token===TokenType.RIGHT_BRACE||token.token===TokenType.RIGHT_BRACKET){stack.pop();complete();return}
      if(top?.type==='object'&&top.expectKey&&token.token===TokenType.STRING){const key=String(token.value);invariant(!top.keys.has(key),'RESULT_FIELDS_INVALID','JSON 对象包含重复字段，不能选择最后一个值覆盖原记录。');top.keys.add(key);top.key=key;top.expectKey=false;return}
      const location=nextPath()
      invariant(stack.length<=16,'RESULT_DEPTH_LIMIT','JSON 嵌套超过当前定位范围。')
      if(token.token===TokenType.LEFT_BRACE||token.token===TokenType.LEFT_BRACKET){stack.push({path:location,type:token.token===TokenType.LEFT_BRACE?'object':'array',index:0,expectKey:token.token===TokenType.LEFT_BRACE,keys:new Set()});return}
      const prefix=parts.length+(arrayRecords?1:0),recordIndex=arrayRecords?Number(location[parts.length]):0
      if(location.length===prefix+1&&parts.every((part,i)=>part===String(location[i]))&&recordIndex<records.length){
        const field=String(location.at(-1)),byteOffset=bom+token.offset,byteEnd=bom+(tokenRows[index+1]?.offset??Buffer.byteLength(decoded))
        const raw=Buffer.from(bytes).subarray(byteOffset,byteEnd).toString('utf8').trim()
        cells.push({field,raw,value:token.value as ResultCell['value'],recordIndex,byteOffset,byteEnd:byteOffset+Buffer.byteLength(raw),locator:{kind:'data',relativePath:path,rowRange:`pointer:${pointer(location)}`,metric:field}})
      }
      complete()
    })
  }else if(format==='txt'||format==='md'){
    // Line records are tab-separated, with a header. This explicit contract avoids guessing log numbers.
    const records=parse(decoded,{delimiter:'\t',bom:true,info:true,raw:true,cast:false,max_record_size:65536}) as unknown as Array<{record:string[];info:{lines:number;bytes:number}}>
    invariant(records.length>1&&records.length<=RESULT_MAX_RECORDS+1,'RESULT_TEXT_MAPPING_REQUIRED','文本结果请提供制表符分隔的表头与记录；自由日志可使用原文测量登记入口。')
    const headers=records[0].record;invariant(headers.length>1&&headers.length<=100&&new Set(headers).size===headers.length,'RESULT_FIELDS_INVALID','文本表头须明确列名且不重复。')
    let previousByte=records[0].info.bytes;records.slice(1).forEach((row,index)=>{signal?.throwIfAborted();row.record.forEach((value,col)=>cells.push({field:headers[col],raw:value,value,recordIndex:index,locator:{kind:'data',relativePath:path,rowRange:`lines:${rowLines(previousByte,row.info.bytes)};column:${col+1}`,metric:headers[col]}}));previousByte=row.info.bytes})
  }else invariant(false,'RESULT_FORMAT_UNSUPPORTED','结果导入支持 UTF-8 CSV、JSON、TXT 与 Markdown；不执行 Notebook 或配置代码。')
  signal?.throwIfAborted();invariant(cells.length<=RESULT_MAX_RECORDS*100,'RESULT_RECORD_LIMIT','结果字段超过当前处理范围。')
  return {format,cells,fields:[...new Set(cells.map(cell=>cell.field))],records:[...new Set(cells.map(cell=>cell.recordIndex))]}
}
