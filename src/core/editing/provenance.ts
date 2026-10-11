import {digest,type FileStore} from '../store/files.ts'
import {snapshot} from '../project/project.ts'
import {readProposal} from './proposals.ts'
import {cowriteSuggestion} from '../../shared/writing-task.ts'
import {parseStored} from '../../shared/errors.ts'

export async function aiProvenance(io:FileStore,text:string,sessionId:string){
  const current=await snapshot(io),hash=digest(text),ranges:Array<{start:number;end:number;proposalId:string}>=[]
  if(hash===current.document.contentHash){
    const manifest=await io.read(`.scholarflow/drafts/${current.document.revisionId}/manifest.json`),origin=manifest&&JSON.parse(manifest.text).origin
    if(typeof origin==='string'&&origin.startsWith('prop_')){
      const proposal=await readProposal(io,origin);let shift=0
      for(const edit of [...proposal.edits].sort((a,b)=>a.startUtf16-b.startUtf16)){const start=edit.startUtf16+shift,end=start+edit.replacementText.length
        if(text.slice(start,end)===edit.replacementText)ranges.push({start,end,proposalId:proposal.id});shift+=edit.replacementText.length-(edit.endUtf16-edit.startUtf16)}
    }
  }
  for(const row of await io.stat('.scholarflow/writing/suggestions')?await io.list('.scholarflow/writing/suggestions'):[]){
    if(row.type!=='file')continue;const file=await io.read(row.path);if(!file)continue
    const suggestion=parseStored(cowriteSuggestion,file.text,'COWRITE_SUGGESTION_INVALID','document.provenance')
    const start=suggestion.acceptedStart??suggestion.start
    if(suggestion.projectId===current.ledger.projectId&&suggestion.sessionId===sessionId&&suggestion.state==='accepted'&&suggestion.acceptedBufferHash===hash&&text.slice(start,start+suggestion.after.length)===suggestion.after)
      ranges.push({start,end:start+suggestion.after.length,proposalId:suggestion.id})
  }
  return ranges
}
