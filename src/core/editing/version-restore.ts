import {digest,json,type FileStore} from '../store/files.ts'
import {snapshot} from '../project/project.ts'
import {saveManual} from './proposals.ts'
import {id} from '../../shared/schema.ts'
import {invariant} from '../../shared/errors.ts'
import {dirtyWritingBuffers} from '../pipeline/writing-task-store.ts'

export async function prepareVersionRestore(io:FileStore,revisionId:string){
  id.parse(revisionId)
  const current=await snapshot(io),file=await io.read(`.scholarflow/drafts/${revisionId}/paper.md`),manifest=await io.read(`.scholarflow/drafts/${revisionId}/manifest.json`)
  invariant(file&&manifest&&JSON.parse(manifest.text).contentHash===digest(file.text),'REVISION_NOT_FOUND','历史快照缺失或已改变。')
  invariant(!current.document.externalChange&&!await dirtyWritingBuffers(io),'UNSAVED_DOCUMENT','请先保存当前编辑或处理外部修改，再恢复历史版本。')
  const plan={projectId:current.ledger.projectId,configHash:current.configHash,revisionId,sourceHash:digest(file.text),manifestHash:digest(manifest.text),
    baseHash:current.document.contentHash,baseRevisionId:current.document.revisionId,ledgerRevision:current.ledger.revision}
  return {...plan,planHash:digest(json(plan)),text:file.text,currentText:current.document.text}
}
export async function restoreVersion(io:FileStore,revisionId:string,planHash:string){
  const plan=await prepareVersionRestore(io,revisionId)
  invariant(plan.planHash===planHash,'RESTORE_PLAN_STALE','恢复预览后稿件或项目数据已改变，请重新预览。')
  return saveManual(io,plan.text,plan.baseHash,plan.ledgerRevision,{origin:`version-restore:${revisionId}`,extra:[],verify:async()=>{
    const fresh=await prepareVersionRestore(io,revisionId)
    invariant(fresh.planHash===planHash,'RESTORE_PLAN_STALE','历史快照或当前稿件已改变，未恢复旧预览。')
  }})
}
