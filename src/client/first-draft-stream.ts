import { useEffect, useRef, useState } from 'react'
import type { DraftPreview } from '../shared/draft-stream.ts'
export type DraftStreamFrame = { task?: { id: string; projectId: string; mode: string; status: string; stage: string; revision: number;
  sectionIndex: number; sections: {id:string;title:string;kind:string;parentId?:string}[]; expectedDocumentHash: string; outcome?:string; stopping?:boolean }; preview?: DraftPreview }

/** One serial observation loop. Unmount only ends observation, never the paid task. */
export function useFirstDraftStream({api,context,project,refresh,mode}: any) {
  const [frame,setFrame] = useState<DraftStreamFrame>({}), [error,setError] = useState('')
  const [epoch,setEpoch] = useState(0)
  const latest = useRef({api,context,project,refresh}); latest.current = {api,context,project,refresh}
  const binding = `${context().workspaceId}:${context().sessionId}:${project.binding.projectId}`
  useEffect(()=>{
    let live=true, watchId:string|undefined, timer:ReturnType<typeof setTimeout>|undefined, seq=-1, attempt='', revision=-1, requestedHash=''
    const controller = new AbortController()
    setFrame({}); setError('')
    const accept = (value:DraftStreamFrame) => {
      if(!live || !value.task || value.task.projectId !== latest.current.project.binding.projectId) return
      if(value.preview && value.preview.projectId !== value.task!.projectId) return
      if(value.preview && value.preview.seq < seq) return
      if(value.preview) seq=value.preview.seq
      if(value.preview?.attemptId!==attempt || value.preview?.seq!==frameRef.current.preview?.seq || value.task?.revision!==revision || value.task?.status!==frameRef.current.task?.status || value.task?.stopping!==frameRef.current.task?.stopping) {
        attempt=value.preview?.attemptId??''; revision=value.task?.revision??-1; frameRef.current=value; setFrame(value)
      }
      const saved=value.task?.expectedDocumentHash
      if(saved && saved!==latest.current.project.document.contentHash && saved!==requestedHash) {
        requestedHash=saved; void latest.current.refresh().catch((failure:Error)=>{requestedHash='';if(live)setError(failure.message)})
      }
    }
    const read=async()=>{
      try {
        if(!watchId) { const result=await latest.current.api('writingTask.watch',{context:latest.current.context()},controller.signal)
          if(!live){if(result.watchId)void latest.current.api('writingTask.unwatch',{watchId:result.watchId}).catch(()=>{});return}
          watchId=result.watchId; if(!watchId)return; accept(result)
        } else accept(await latest.current.api('writingTask.stream',{context:latest.current.context(),watchId},controller.signal))
      } catch(failure) {
        if(!live)return
        if((failure as any).code==='DRAFT_WATCH_STALE'){watchId=undefined;seq=-1;revision=-1}
        else {setError((failure as Error).message);return}
      }
      if(live)timer=setTimeout(read,document.hidden?2000:250)
    }
    void read()
    return()=>{live=false;controller.abort();clearTimeout(timer);if(watchId)void latest.current.api('writingTask.unwatch',{watchId}).catch(()=>{})}
  },[binding,mode,epoch])
  const frameRef=useRef<DraftStreamFrame>({})
  const generating=frame.task?.mode==='first-draft' && ['running','queued'].includes(frame.task.status)
  return { ...frame,generating,error,reconnect:()=>setEpoch(value=>value+1) }
}
