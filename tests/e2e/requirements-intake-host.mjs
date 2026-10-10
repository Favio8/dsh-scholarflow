// Installed DSH + real bridge/read/parser. No model calls. Separate from the controlled UI test.
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, writeFile, readFile, readdir, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve('.dsh-tmp/requirements-intake-host', String(Date.now()))
const profile = join(root, 'profiles/intake-test'), workspace = join(root, 'Workspace TEST_ONLY')
const original = 'TEST_ONLY 作业要求：写一篇约 1500 字的阅读报告。'
await mkdir(join(profile, 'node_modules'), { recursive: true })
await mkdir(join(workspace, '作业要求'), { recursive: true })
for (const name of ['1.txt', '2.txt', '3.txt']) await writeFile(join(workspace, '作业要求', name), original)
await writeFile(join(workspace, 'unsupported.bin'), Buffer.from([0, 255, 1]))
await writeFile(join(profile, 'package.json'), JSON.stringify({ private: true,
  dependencies: { 'dsh-scholarflow': 'link:' + resolve('.').replaceAll('\\', '/') },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-scholarflow'] } } }))
await writeFile(join(profile, 'cordis.yml'), '[]\n')
await symlink(resolve('.'), join(profile, 'node_modules/dsh-scholarflow'), 'junction')
const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const host = spawn(join(install, 'DeepSeek Harness.exe'), ['--expose-internals',
  join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
  'intake-test', '--no-open', '--port', '0'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, DSH_HOME: root, ELECTRON_RUN_AS_NODE: '1', DSH_PERMISSION_MODE: 'workspace-write' } })
const ready = new Promise((done, reject) => {
  const timer = setTimeout(() => reject(new Error('Host startup timeout')), 30000)
  let output = ''
  host.stdout.on('data', chunk => {
    output += chunk.toString()
    const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/)
    if (match) { clearTimeout(timer); done(match[1]) }
  })
  host.once('exit', code => { clearTimeout(timer); reject(new Error('Host exited: ' + code)) })
  host.once('error', error => { clearTimeout(timer); reject(error) })
})
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const results = []
const pass = name => { results.push(name); console.log('PASS ' + name) }
try {
  const page = await browser.newPage()
  await page.goto(await ready)
  const rpc = (method, args) => page.evaluate(async ({ method, args }) => {
    const response = await fetch('api/' + method, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args } }) })
    const result = (await response.json()).result
    if (!result.ok || result.value?.ok === false) throw new Error(JSON.stringify(result.error ?? result.value.error))
    return result.value?.data ?? result.value
  }, { method, args })
  const workspaceId = (await rpc('workspace/create', { request: { path: workspace } })).workspace.workspaceId
  const sessionId = (await rpc('session/create', { request: { workspaceId, agentPreset: 'scholarflow' } })).sessionId
  const context = { requestId: 'req_TEST_ONLY', workspaceId, sessionId }
  const api = (method, data) => rpc('scholarflow.v1/' + method, { request: { context, ...data } })
  const stopped = await api('outline.stop', { operationId: 'op_TEST_ONLY' })
  assert.equal(typeof stopped.stopped, 'boolean')
  pass('outline stop is registered on the actual installed-host bridge')
  const base = { title: '', requirements: '', type: 'course-paper', language: 'zh-CN', format: 'docx',
    materials: [], targetLength: 4000, sections: [{ id: 'section_1', title: '引言', targetLength: 4000 }] }
  const source = { resourceId: 'req_folder', origin: 'workspace', kind: 'folder', path: '作业要求',
    members: ['1.txt', '2.txt', '3.txt'].map(name => ({ name: '作业要求/' + name })) }
  const settle = async readId => {
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      const state = await api('creation.readStatus', { readId })
      if (state.state !== 'reading') return state
      await new Promise(done => setTimeout(done, 150))
    }
    throw new Error('Read did not settle')
  }
  const spec = { ...base, requirementSources: [source] }
  const { readId } = await api('creation.readRequirements', { spec })
  const read = await settle(readId)
  assert.equal(read.state, 'ready')
  assert.equal(read.total, 3)
  assert(read.members.every(member => member.state === 'ready' && member.chars === original.length))
  pass('empty title and requirements reach the real host and read every selected folder member')
  const retry = await api('creation.retryMember', { spec, readId, member: '作业要求/2.txt' })
  assert.equal(retry.read.members[1].state, 'ready')
  pass('a source-only draft can retry a member through the real bridge')
  const textOnly = await api('creation.readRequirements', { spec: { ...base, requirements: original } })
  assert.equal((await settle(textOnly.readId)).total, 0)
  pass('text-only input starts a zero-file read without requiring a title or inventing files')
  const failedSpec = { ...base, requirementSources: [{ resourceId: 'req_bin', origin: 'workspace', kind: 'file', path: 'unsupported.bin' }] }
  const failed = await api('creation.readRequirements', { spec: failedSpec })
  assert.equal((await settle(failed.readId)).members[0].state, 'failed')
  await assert.rejects(api('creation.structure', { spec: failedSpec, readId: failed.readId }), /READ_EMPTY/)
  pass('all-unread sources fail before any model request instead of inventing a requirements candidate')
  await assert.rejects(api('creation.prepare', { spec: { ...spec, title: 'TEST_ONLY' } }), /requirements/)
  assert.deepEqual((await readdir(workspace)).sort(), ['unsupported.bin', '作业要求'].sort())
  for (const member of source.members) assert.equal(await readFile(join(workspace, member.name), 'utf8'), original)
  pass('submission still rejects unconfirmed requirements; original files and workspace remain unchanged')
  console.log(results.length + ' checks passed; evidence: ' + root)
} finally {
  await writeFile(join(root, 'report.json'), JSON.stringify({ results }, null, 2))
  await browser.close()
  if (host.exitCode === null) { host.kill(); await new Promise(done => host.once('exit', done)) }
}
