// TEST_ONLY synthetic materials and parser output; no user text or model calls.
import { MemoryStore } from './memory-store.ts'
import { initialize, prepareInit, snapshot } from '../../src/core/project/project.ts'
import { registerMaterial, recordParsed } from '../../src/core/materials/materials.ts'
import { registerSource } from '../../src/core/evidence/evidence.ts'
import { createWritingTask, saveWritingTask } from '../../src/core/pipeline/writing-task-store.ts'
import { creationSpec } from '../../src/shared/writing-task.ts'
import { digest } from '../../src/core/store/files.ts'

export const publication = 'TEST_ONLY Shared Publication Title'
export const paperPath = 'TEST_ONLY_Shared_Publication_Title.pdf'
export async function sourceConflictFixture(existing = true) {
  const io = new MemoryStore({ 'reading-notes.md': publication + '\nTEST_ONLY independent reading notes.',
    [paperPath]: publication + '\nTEST_ONLY actual paper body.' })
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY source conflict', type: 'course-paper' }))
  const materials = []
  for (const [path, role] of [['reading-notes.md', 'notes'], [paperPath, 'paper']] as const) {
    const material = (await registerMaterial(io, { relativePath: path, role, confirmExcludedFile: false }, (await snapshot(io)).ledger.revision)).material
    const text = (await io.read(path))!.text
    await recordParsed(io, { schemaVersion: 1, materialId: material.id, sourceContentHash: digest(text),
      parser: { id: 'TEST_ONLY', version: '1' }, coverage: 'complete', warnings: [], unprocessedContent: [], ranges: [{ kind: 'paragraphs', from: 1, to: 1 }],
      blocks: [{ text, kind: 'paragraph', locator: { kind: 'text', lineStart: 1, lineEnd: 2 } }] }, (await snapshot(io)).ledger.revision)
    materials.push(material)
  }
  const source = existing ? (await registerSource(io, { title: publication, authors: [], kind: 'other', identifiers: {},
    materialId: materials[0].id }, (await snapshot(io)).ledger.revision)).source : undefined
  const spec = creationSpec.parse({ title: 'TEST_ONLY source conflict', requirements: 'TEST_ONLY analyze selected materials', type: 'course-paper',
    language: 'zh-CN', format: 'markdown', targetLength: 500, materials: ['reading-notes.md', paperPath], sections: [{ id: 'section_TEST_ONLY', title: 'TEST_ONLY analysis', targetLength: 500 }] })
  const task = await createWritingTask(io, spec, 'session_TEST_ONLY', 'TEST_ONLY')
  task.stage = 'evidence'; task.evidenceMaterialIndex = existing ? 1 : 0
  await saveWritingTask(io, task)
  return { io, task, source, materials }
}
