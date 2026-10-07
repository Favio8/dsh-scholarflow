import { id } from '../../shared/schema.ts'
import { bufferSchema } from '../../shared/editor-buffer.ts'
import { snapshot } from '../project/project.ts'
import { digest, json, type FileStore } from '../store/files.ts'
import { invariant, parseStored } from '../../shared/errors.ts'

const bufferPath = (sessionId: string) => `.scholarflow/drafts/editor-buffers/${id.parse(sessionId)}.json`
export async function readEditorBuffer(io: FileStore, sessionId: string) {
  const current = await snapshot(io), file = await io.read(bufferPath(sessionId))
  if (!file) return { buffer: undefined, bufferHash: null }
  const buffer = parseStored(bufferSchema, file.text, 'EDITOR_BUFFER_INVALID', 'editorBuffer.read')
  invariant(buffer.projectId === current.ledger.projectId && buffer.sessionId === sessionId, 'EDITOR_BUFFER_IDENTITY_CHANGED', '暂存缓冲的项目或会话身份不同，已保留文件。')
  return { buffer, bufferHash: digest(file.text) }
}

// A buffer is an explicit uncommitted user edit, never another manuscript truth
// source. Single-file atomic CAS needs no ledger mutation or multi-file journal.
export async function writeEditorBuffer(io: FileStore, sessionId: string, input: { baseBufferHash: string | null; baseHash: string; text: string; state: 'dirty' | 'cleared' }) {
  return io.lock(async () => {
    invariant(input.text.isWellFormed(), 'INVALID_EDITOR_TEXT', '暂存文字包含无效 Unicode，已保留旧缓冲。')
    const current = await snapshot(io), path = bufferPath(sessionId), previous = await io.read(path)
    invariant((previous ? digest(previous.text) : null) === input.baseBufferHash, 'EDITOR_BUFFER_CONFLICT', '另一个页面或会话已更新这份暂存缓冲，未覆盖其内容。请比较或恢复宿主缓冲。')
    if (previous) { const old = parseStored(bufferSchema, previous.text, 'EDITOR_BUFFER_INVALID', 'editorBuffer.write'); invariant(old.projectId === current.ledger.projectId && old.sessionId === sessionId, 'EDITOR_BUFFER_IDENTITY_CHANGED', '缓冲身份已改变。') }
    const buffer = bufferSchema.parse({ schemaVersion: 1, projectId: current.ledger.projectId, sessionId, documentId: 'paper',
      baseHash: input.baseHash, text: input.state === 'cleared' ? '' : input.text, state: input.state, updatedAt: new Date().toISOString() })
    const text = json(buffer)
    await io.write(path, text, previous)
    return { buffer, bufferHash: digest(text) }
  })
}
