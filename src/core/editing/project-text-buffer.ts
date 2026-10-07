import { id } from '../../shared/schema.ts'
import { projectTextBufferSchema } from '../../shared/project-text-buffer.ts'
import { projectTextPaths } from '../../shared/requirements.ts'
import { snapshot } from '../project/project.ts'
import { digest, json, type FileStore } from '../store/files.ts'
import { invariant, parseStored } from '../../shared/errors.ts'

type ProjectTextPath = typeof projectTextPaths[number]
function bufferPath(sessionId: string, path: ProjectTextPath) {
  id.parse(sessionId)
  invariant(projectTextPaths.includes(path), 'PATH_OUTSIDE_ALLOWED_ROOT', '暂存仅支持项目文风与记忆文件。')
  return `.scholarflow/drafts/project-text-buffers/${sessionId}/${digest(path).slice(7)}.json`
}
async function readBoundBuffer(io: FileStore, sessionId: string, path: ProjectTextPath, projectId: string) {
  const target = bufferPath(sessionId, path), info = await io.stat(target)
  invariant(!info || info.type === 'file' && info.size <= 512 * 1024, 'PROJECT_TEXT_BUFFER_INVALID', '暂存文件不是普通文件或超过读取限额。')
  const file = await io.read(target)
  if (!file) return { buffer: undefined, bufferHash: null, file }
  const buffer = parseStored(projectTextBufferSchema, file.text, 'PROJECT_TEXT_BUFFER_INVALID', 'projectBuffer.read')
  invariant(buffer.projectId === projectId && buffer.sessionId === sessionId && buffer.path === path &&
    buffer.text.isWellFormed() && Buffer.byteLength(buffer.text) <= 65536,
    'EDITOR_BUFFER_IDENTITY_CHANGED', '暂存缓冲的项目、会话或文件身份不符，已保留原文件。')
  return { buffer, bufferHash: digest(file.text), file }
}
export async function readProjectTextBuffer(io: FileStore, sessionId: string, path: ProjectTextPath) {
  const current = await snapshot(io), { file: _file, ...result } = await readBoundBuffer(io, sessionId, path, current.ledger.projectId)
  return result
}
// Scratch publication never changes a Profile, memory approval, provenance,
// ledger revision, main manuscript or Agent stage input.
export async function writeProjectTextBuffer(io: FileStore, sessionId: string, path: ProjectTextPath,
  input: { baseBufferHash: string | null; baseHash: string; text: string; state: 'dirty' | 'cleared' }) {
  invariant(input.text.isWellFormed() && Buffer.byteLength(input.text) <= 65536, 'INVALID_EDITOR_TEXT', '暂存文字最多 64 KiB，且须是完整 Unicode。')
  return io.lock(async () => {
    const current = await snapshot(io), previous = await readBoundBuffer(io, sessionId, path, current.ledger.projectId)
    invariant(previous.bufferHash === input.baseBufferHash, 'EDITOR_BUFFER_CONFLICT', '另一个页面已更新这份未提交编辑，请比较双方，未覆盖旧缓冲。')
    const buffer = projectTextBufferSchema.parse({ schemaVersion: 1, projectId: current.ledger.projectId, sessionId, path,
      baseHash: input.baseHash, text: input.state === 'cleared' ? '' : input.text, state: input.state, updatedAt: new Date().toISOString() })
    const text = json(buffer)
    await io.write(bufferPath(sessionId, path), text, previous.file)
    return { buffer, bufferHash: digest(text) }
  })
}
