import { JSONParser } from '@streamparser/json'
import { draftPreviewSchema, type DraftPreview } from '../../shared/draft-stream.ts'
import { json, newId, type FileStore } from '../../core/store/files.ts'
import { parseStored } from '../../shared/errors.ts'

export class BodyStreamDecoder {
  private parser = new JSONParser({ paths: ['$.replacementText'], emitPartialTokens: true, emitPartialValues: true })
  private invalid = false
  private prefix = ''
  private started = false
  constructor(onText: (text: string) => void) {
    this.parser.onValue = ({ value, key }) => { if (key === 'replacementText' && typeof value === 'string' && value.isWellFormed()) onText(value) }
    this.parser.onError = () => { this.invalid = true }
  }
  write(delta: string) {
    if(this.invalid)return
    if(!this.started){
      this.prefix+=delta
      const text=this.prefix.replace(/^\uFEFF/,'').trimStart()
      if(!text)return
      if(text.startsWith('`')){
        if(!text.includes('\n'))return
        const fence=/^```(?:json)?[\t ]*\r?\n/i.exec(text)
        if(!fence){this.invalid=true;return}
        delta=text.slice(fence[0].length)
      }else if(text.startsWith('{'))delta=text
      else {this.invalid=true;return}
      this.started=true;this.prefix=''
    }
    try{this.parser.write(delta)}catch{this.invalid=true}
  }
}
export const draftPreviewPath = (taskId: string) => `.scholarflow/cache/draft-previews/${taskId}.json`
export async function readDraftPreview(io: FileStore, taskId: string) {
  const file = await io.read(draftPreviewPath(taskId))
  return file ? parseStored(draftPreviewSchema, file.text, 'DRAFT_PREVIEW_INVALID', 'draft.preview') : undefined
}
export class DraftStreamCache {
  private values = new Map<string, DraftPreview>()
  private tails = new Map<string, Promise<void>>()
  private persistedAt = new Map<string, number>()
  peek(taskId: string) { return this.values.get(taskId) }
  restore(preview: DraftPreview) { if (!this.values.has(preview.taskId)) this.values.set(preview.taskId, preview) }
  begin(input: Omit<DraftPreview,'schemaVersion'|'attemptId'|'seq'|'status'|'text'>) {
    const preview = draftPreviewSchema.parse({ ...input, schemaVersion: 1, attemptId: newId('attempt'), seq: (this.values.get(input.taskId)?.seq ?? 0) + 1, text: '', status: 'generating' })
    this.values.set(input.taskId, preview)
    return preview.attemptId
  }
  update(taskId: string, attemptId: string, patch: Partial<Pick<DraftPreview,'text'|'status'|'savedDocumentHash'>>) {
    const current = this.values.get(taskId)
    if (!current || current.attemptId !== attemptId || ['paused','stopped','saved','failed'].includes(current.status) && patch.text !== undefined) return
    this.values.set(taskId, draftPreviewSchema.parse({ ...current, ...patch, seq: current.seq + 1 }))
  }
  async persist(io: FileStore, taskId: string, force = false) {
    const value = this.values.get(taskId)
    if (!value || !force && Date.now() - (this.persistedAt.get(taskId) ?? 0) < 5000) return
    this.persistedAt.set(taskId, Date.now())
    const operation = (this.tails.get(taskId) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      await io.lock(async () => { const path = draftPreviewPath(taskId); await io.write(path, json(value), await io.read(path)) })
    })
    this.tails.set(taskId, operation); await operation
  }
  clear() { this.values.clear() }
}
