import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MEMBER_LIMIT, failureNote, finishRead, memberKind, pendingMembers, phaseOf, planRead, settleMember, startRead, usableText } from '../../src/core/requirements/reading.ts'
import type { RequirementSource } from '../../src/shared/writing-task.ts'

const at = '2026-10-06T00:00:00.000Z'
// The wizard stores a folder's members as their full relative paths, so the fixture does too.
const folder = (members: string[], id = 'req_a', root = '作业要求'): RequirementSource => ({ resourceId: id, origin: 'workspace', kind: 'folder',
  path: root, members: members.map(name => ({ name: `${root}/${name}` })), role: 'assignment', state: 'selected' })
const file = (path: string, id = 'req_b'): RequirementSource => ({ resourceId: id, origin: 'workspace', kind: 'file',
  path, members: [], role: 'assignment', state: 'selected' })

test('a folder expands into its own members and never becomes a member itself', () => {
  const plan = planRead([folder(['1.jpg', '2.jpg', '3.jpg'])])
  assert.deepEqual(plan.members.map(member => member.name), ['作业要求/1.jpg', '作业要求/2.jpg', '作业要求/3.jpg'])
  assert.equal(plan.members.some(member => member.name === '作业要求'), false, 'the folder path itself is never a member')
  assert.equal(plan.skipped, 0)
})

test('images, pdfs and documents are classified separately, and unknown extensions are unsupported', () => {
  assert.equal(memberKind('作业要求/1.JPG'), 'image')
  assert.equal(memberKind('paper.pdf'), 'pdf')
  assert.equal(memberKind('报告笔记.md'), 'text')
  assert.equal(memberKind('archive.zip'), 'unsupported')
  const plan = planRead([folder(['a.jpg', 'b.pdf', 'c.docx', 'd.zip'])])
  assert.deepEqual(plan.members.map(member => member.kind), ['image', 'pdf', 'text', 'unsupported'])
})

test('a source over the member limit is truncated and reported instead of silently dropped', () => {
  const many = Array.from({ length: MEMBER_LIMIT + 7 }, (_, index) => `f${index}.txt`)
  const plan = planRead([folder(many)])
  assert.equal(plan.members.length, MEMBER_LIMIT)
  assert.equal(plan.skipped, 7)
})

test('external sources contribute the members the picker listed, under their own handle', () => {
  const external: RequirementSource = { resourceId: 'req_ext', origin: 'external', kind: 'folder', handle: 'handle_TEST_ONLY',
    members: [{ name: 'syllabus.pdf' }], role: 'assignment', state: 'connected' }
  const plan = planRead([external, file('notes.md')])
  assert.deepEqual(plan.members.map(member => member.name), ['syllabus.pdf', 'notes.md'])
  assert.deepEqual(plan.members.map(member => member.origin), ['external', 'workspace'])
})

test('the phase label counts real objects and says 文件 for documents, 图片 for images', () => {
  const plan = planRead([folder(['a.jpg', 'b.jpg']), file('notes.md', 'req_b')])
  let read = startRead({ readId: 'read_TEST', projectId: 'p', sessionId: 's', members: plan.members, at })
  // Member order is the user's order: the image is first, so the phase says so and still
  // reports the real position over every member.
  assert.match(phaseOf(read), /识别图片 1\/3/)
  read = settleMember(read, '作业要求/a.jpg', { state: 'ready', text: '题名' }, at)
  assert.match(phaseOf(read), /识别图片 2\/3/)
  read = settleMember(read, '作业要求/b.jpg', { state: 'ready', text: '九项' }, at)
  assert.match(phaseOf(read), /读取第 3\/3 个文件/)
  read = settleMember(read, 'notes.md', { state: 'ready', text: '要 求' }, at)
  assert.equal(read.done, 3)
  assert.equal(read.total, 3)
  assert.equal(phaseOf(read), '整理已读要求')
})

test('stopping keeps what was read and resumes from the unfinished members only', () => {
  const plan = planRead([folder(['1.jpg', '2.jpg', '3.jpg'])])
  let read = startRead({ readId: 'read_TEST', projectId: 'p', sessionId: 's', members: plan.members, at })
  read = settleMember(read, '作业要求/1.jpg', { state: 'ready', text: '论文题名' }, at)
  read = finishRead(read, 'stopped', at)
  assert.equal(read.state, 'stopped')
  assert.equal(read.done, 1)
  assert.equal(phaseOf(read), '已停止')
  assert.deepEqual(pendingMembers(read).map(member => member.name), ['作业要求/2.jpg', '作业要求/3.jpg'])
  assert.equal(usableText(read), '【作业要求/1.jpg】\n论文题名')
})

test('a failed member does not stop the others, and its text never counts as read', () => {
  const plan = planRead([folder(['ok.jpg', 'bad.pdf'])])
  let read = startRead({ readId: 'read_TEST', projectId: 'p', sessionId: 's', members: plan.members, at })
  read = settleMember(read, '作业要求/bad.pdf', { state: 'failed', ...failureNote({ kind: 'read', name: 'bad.pdf', pages: { read: 0, total: 6 } }) }, at)
  read = settleMember(read, '作业要求/ok.jpg', { state: 'ready', text: '要求文字' }, at)
  read = finishRead(read, 'ready', at)
  assert.equal(read.done, 2)
  const failed = read.members.find(member => member.name === '作业要求/bad.pdf')!
  assert.equal(failed.state, 'failed')
  assert.match(failed.note!, /共 6 页，已读到 0 页/)
  assert.equal(usableText(read).includes('bad.pdf'), false, 'a failed member contributes no text')
})

test('failure wording is actionable and never exposes an exception or pushes the work back', () => {
  const capability = failureNote({ kind: 'capability', name: '1.jpg', model: 'deepseek-v4.1-flash', candidates: ['deepseek-v4-flash-vision-exp'] })
  assert.match(capability.note, /不接受图片输入/)
  assert.match(capability.note, /deepseek-v4-flash-vision-exp/)
  assert.match(capability.note, /粘贴/)
  const empty = failureNote({ kind: 'capability', name: '1.jpg', model: 'm' })
  assert.match(empty.note, /粘贴文字/)
  const format = failureNote({ kind: 'format', name: 'a.zip' })
  assert.match(format.note, /格式暂时不能直接读取/)
  const authorised = failureNote({ kind: 'authorisation', name: 'x' })
  assert.match(authorised.note, /重新选择/)
  for (const note of [capability.note, empty.note, format.note, authorised.note]) {
    assert.equal(/Error|TypeError|undefined|请 AI|人工转录|当前解析器/.test(note), false, note)
    assert.equal(note.includes('['), false, note)
  }
})
