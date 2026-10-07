// Real-model continuation of an isolated assignment checkpoint. No fixed output is injected.
// Usage: node tests/e2e/assignment-closeout.mjs <baseline journal.json>
import {chromium} from '@playwright/test'
import {spawn} from 'node:child_process'
import {mkdir,writeFile,appendFile,readFile,stat} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {join,resolve} from 'node:path'
import {writingTaskSchema} from '../../src/shared/writing-task.ts'
import {projectMarkdown} from '../../src/core/editing/markdown.ts'
const SOURCE='C:/Users/19949/Desktop/科技论文写作'
const baseline=JSON.parse(await readFile(process.argv[2],'utf8'))
const setup=baseline.find(row=>row.phase==='setup'), session=baseline.find(row=>row.phase==='session'), created=baseline.find(row=>row.phase==='created')
const {home,workspaceRoot}=setup
const install=join(process.env.LOCALAPPDATA,'Programs/DeepSeek Harness'), stamp=String(Date.now()), port=19943
const outDir=resolve('.dsh-tmp/assignment-closeout',stamp)
await mkdir(outDir,{recursive:true})
const taskDir=join(workspaceRoot,'.scholarflow/writing/tasks'), pointer=JSON.parse(await readFile(join(workspaceRoot,'.scholarflow/writing/current.json'),'utf8'))
const taskPath=join(taskDir,pointer.taskId+'.json'), task=writingTaskSchema.parse(JSON.parse(await readFile(taskPath,'utf8')))
// Only the isolated test checkpoint is changed, while its draft, evidence and provenance remain.
task.stage='review';task.status=process.argv.includes('--review-export-only')?'cancelled':'paused';task.modelReviewComplete=false;task.reviewStalls=0;task.semanticReviewStalls=0
await writeFile(join(outDir,'checkpoint-before.json'),JSON.stringify(task,null,2))
if (process.argv.includes('--replan-length')) {
  // Replace the obsolete whole-manuscript repair plan after deploying the measured-length
  // repair. Keep the actually generated manuscript, source cache and automatic-section hashes.
  delete task.revisionPlan; delete task.pendingProposalId; delete task.childRunId
}
await writeFile(taskPath,JSON.stringify(task,null,2))
if (process.argv.includes('--adopt-host-checkpoint')) {
  const path = join(workspaceRoot, '.scholarflow/drafts/editor-buffers', session.sessionId + '.json')
  const buffer = JSON.parse(await readFile(path, 'utf8'))
  if ('sha256:' + createHash('sha256').update(buffer.text).digest('hex') !== buffer.baseHash) throw Error('This buffer contains actual edits; do not discard it')
  await writeFile(join(outDir, 'obsolete-buffer.json'), JSON.stringify(buffer, null, 2))
  await writeFile(path, JSON.stringify({ ...buffer, state: 'cleared', text: '', updatedAt: new Date().toISOString() }))
}
const before=JSON.parse(await readFile(join(setup.outDir,'originals-before.json'),'utf8'))
const journal=[],progressPath=join(outDir,'progress.log')
const record=(phase,data)=>{journal.push({at:new Date().toISOString(),phase,...data});const line=phase+' '+JSON.stringify(data).slice(0,1000);console.log(line);appendFile(progressPath,line+'\n').catch(()=>undefined)}
const hashFile=async path=>createHash('sha256').update(await readFile(path)).digest('hex')
record('setup',{home,workspaceRoot,outDir,baseline:process.argv[2], replanLength: process.argv.includes('--replan-length')})
const child = spawn(join(install, 'DeepSeek Harness.exe'), ['--expose-internals',
  join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
  'scholarflow-assignment', '--no-open', '--port', String(port)], {
  env: { ...process.env, DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1', DSH_PERMISSION_MODE: 'workspace-write',
    SCHOLARFLOW_TRACE: join(outDir, 'stage-trace.log') },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
let hostLog = ''
child.stdout.on('data', chunk => { hostLog += chunk.toString() })
child.stderr.on('data', chunk => { hostLog += chunk.toString() })

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
let page, contextBody
const finish = async (code) => {
  journal.push({ at: new Date().toISOString(), phase: 'done', code })
  await writeFile(join(outDir, 'journal.json'), JSON.stringify(journal, null, 2))
  await writeFile(join(outDir, 'host.log'), hostLog)
  child.kill()
  try { await browser.close() } catch { /* already closed */ }
  console.log(String.fromCharCode(10) + `journal: ${join(outDir, 'journal.json')}`)
  process.exitCode = code
  // Thrown so the run unwinds here instead of driving a browser that is already closed.
  throw new StopRun()
}
/** Sentinel used to unwind once `finish` has recorded its journal and cleaned up. */
class StopRun extends Error { constructor() { super('run finished') } }

try {
  const url = await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Host boot timed out')), 60000)
    let output = ''
    child.stdout.on('data', chunk => { output += chunk.toString()
      const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/)
      if (match) { clearTimeout(timer); done(match[1]) } })
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`Host exited ${code}`)) })
  })
  page = await (await browser.newContext()).newPage()
  page.setDefaultTimeout(30000)
  await page.goto(url)
  await page.waitForTimeout(1500)
  for (const [matcher, label] of [[/^预览版说明/, '继续'], [/^添加一个 API Key/, '稍后配置']]) {
    const dialogs = page.getByRole('dialog')
    if (await dialogs.count() && matcher.test(await dialogs.first().innerText().catch(() => '')))
      await dialogs.first().getByRole('button', { name: label, exact: true }).click().catch(() => undefined)
    await page.waitForTimeout(700)
  }
  // Plugin remotes answer with an application envelope: {ok, data} or {ok:false, error}.
  // Unwrapping it here keeps every call site readable and makes a refusal visible instead of
  // silently undefined.
  const remote = (name, request = {}) => page.evaluate(async ({ name, request }) => {
    const response = await fetch(`api/scholarflow.v1/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: `scholarflow.v1/${name}`, payload: { args: { request } } }) })
    const text = await response.text()
    let body
    try { body = JSON.parse(text) } catch { return { ok: false, error: { code: 'NON_JSON', message: text.slice(0, 300) } } }
    const value = body?.result?.value ?? body
    return value?.ok === false ? { ok: false, error: value.error } : { ok: true, data: value?.data ?? value }
  }, { name, request })
  const call = async (method, args = {}) => {
    const value = await page.evaluate(async ({ method, args }) => {
      const response = await fetch(`api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args } }) })
      const text = await response.text()
      try { return JSON.parse(text)?.result?.value ?? JSON.parse(text) } catch { return { raw: text.slice(0, 300) } }
    }, { method, args })
    return value
  }
  /** Runs a remote and fails loudly with the plugin's own message. */
  const withTimeout = async (promise, label, ms = 10 * 60 * 1000) => {
    let timer
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + ' did not answer within ' + Math.round(ms / 1000) + 's')), ms) })]) }
    finally { clearTimeout(timer) }
  }
  const must = async (name, request, ms) => {
    record('call', { name })
    const result = await withTimeout(remote(name, request), name, ms)
    if (result.ok === false) throw new Error(`${name} refused: ${result.error?.code} ${result.error?.message} ${JSON.stringify(result.error?.details ?? {})}`)
    return result.data
  }

  const projectContext={requestId:'req_closeout_'+stamp,workspaceId:session.workspaceId,sessionId:session.sessionId,projectId:created.projectId}
  if (process.argv.includes('--review-export-only')) {
    const current = await must('document.read', { context: projectContext })
    // Explicit editorial changes to the isolated generated draft; the journal records
    // them separately from the clean automatic run. No reference answer is used.
    const revised = current.document.text.replace('本批可见文本', '论文全文').replace('本批可见', '论文全文')
      .replace('## 总体结构与承接关系\n\n', '')
    if (revised !== current.document.text) await must('document.saveManual', { context: { ...projectContext, expectedLedgerRevision: current.revision }, text: revised, baseHash: current.document.contentHash })
    record('editorial-change', { change: 'Remove an inaccurate internal batch qualifier; the full PDF is present in the evidence cache', changed: revised !== current.document.text })
    if (process.argv.includes('--expand-delivery')) {
      const state = await must('document.read', { context: projectContext })
      const block = projectMarkdown(state.document.text).blocks.filter(row => row.node.type === 'paragraph').at(-1)
      if (!block) throw Error('No reference analysis paragraph to expand')
      const proposed = await must('cowrite.propose', { context: projectContext, text: state.document.text,
        baseDocumentHash: state.document.contentHash, start: block.start, end: block.end, action: 'expand',
        instruction: '仅扩写选中的参考文献分析段，在现有内容基础上增加约190个汉字。保留现有事实和引用。结合报告已经分析的相关工作、方法和实验，解释文献如何分别承担研究脉络、技术来源、数据集与比较基线的支撑作用，以及正文引用与文后条目对应如何让读者追溯论证。不要新增具体文献、数量、额外性能数据或核验声明，不写用户自己做过实验。返回完整替换段落。' })
      await writeFile(join(outDir, 'accepted-ai-expansion.json'), JSON.stringify(proposed.suggestion, null, 2))
      const suggestion = proposed.suggestion
      if (suggestion.before !== state.document.text.slice(block.start, block.end) || suggestion.citationChanges.removed.length || suggestion.citationChanges.added.length)
        throw Error('Expansion changed the selection or protected citations')
      await must('document.saveManual', { context: { ...projectContext, expectedLedgerRevision: state.revision },
        text: state.document.text.slice(0, block.start) + suggestion.after + state.document.text.slice(block.end), baseHash: state.document.contentHash })
      record('accepted-ai-expansion', { suggestionId: suggestion.id, before: suggestion.before, after: suggestion.after,
        protectedFactChanges: suggestion.protectedFactChanges })
    }
    const document = await must('document.read', { context: projectContext })
    const plan = await must('review.prepareModel', { context: { ...projectContext, expectedLedgerRevision: document.revision }, assessmentScope: 'cross-section' })
    const reviewed = await must('review.startModel', { context: projectContext, planId: plan.planId, planHash: plan.planHash })
    record('semantic-review', { checks: reviewed.report?.checks, issues: reviewed.report?.issues?.filter(row => row.state === 'open' && !row.stale) })
  } else {
  if (process.argv.includes('--replan-length')) {
    const history = await must('runs.list', { context: projectContext })
    for (const row of history.runs.filter(run => ['queued', 'running', 'waiting-input', 'paused', 'interrupted'].includes(run.status))) {
      const doc = await must('document.read', { context: projectContext })
      const context = { ...projectContext, expectedLedgerRevision: doc.revision }
      const plan = await must('runs.prepareAction', { context, runId: row.runId, action: 'close' })
      await must('runs.confirmAction', { context, planId: plan.planId, planHash: plan.planHash })
      record('obsolete-run-closed', { runId: row.runId, previous: row.status })
    }
  }
  const pending = task.questions.find(row => row.answered === undefined)
  if (pending && process.argv.includes('--adopt-host-checkpoint') && pending.kind === 'conflict') {
    await must('writingTask.action', { context: projectContext, taskId: task.id, action: 'answer', questionId: pending.id, answer: '已处理，继续' })
  } else if (pending && process.argv.includes('--replan-length')) {
    await must('writingTask.action', { context: projectContext, taskId: task.id, action: 'answer', questionId: pending.id, answer: '继续' })
  } else await must('writingTask.action',{context:projectContext,taskId:task.id,action:'resume'})
  for(let poll=0;poll<180;poll++) {
    const state=(await must('writingTask.inspect',{context:projectContext})).task
    record('progress',{status:state.status,stage:state.stage,calls:state.usedModelCalls})
    if(state.status==='waiting-input') throw new Error('Task paused for a real decision: '+JSON.stringify(state.questions.filter(row=>!row.answered)))
    if(['completed','cancelled','failed'].includes(state.status)) {record('task',{status:state.status,calls:state.usedModelCalls});break}
    await page.waitForTimeout(5000)
    if(poll===179) throw Error('Checkpoint did not settle')
  }
  }
  const document = await must('document.read', { context: projectContext })
  await writeFile(join(outDir, 'manuscript.md'), document?.document?.text ?? '')
  const stats = document?.statistics
  record('manuscript', { chars: stats?.chineseCharacters, words: stats?.westernWords, detail: stats?.detail,
    headings: (document?.document?.text ?? '').split('\n').filter(line => /^#{1,2} /.test(line)).length })

  // ── 8. export the Word file and measure the real pages ───────────────────────────────────
  // A mutating call has to name the ledger revision it is based on; the driver reads it from
  // the document the same way the client does.
  projectContext.expectedLedgerRevision = document.revision
  const preflight = await must('export.preflight', { context: projectContext, format: 'docx' })
  if (!preflight?.planId) throw new Error(`preflight failed: ${JSON.stringify(preflight).slice(0, 200)}`)
  record('preflight', { format: preflight.format, reviewState: preflight.reviewState, notes: preflight.formatNotes })
  const delivery = await must('export.create', { context: projectContext, planId: preflight.planId, planHash: preflight.planHash, deliveryType: 'working-draft' })
  record('delivery', { deliveryId: delivery?.manifest?.id, files: delivery?.manifest?.files?.map(file => file.relativePath) })
  const exported = await must('export.read', { context: projectContext, deliveryId: delivery.manifest.id })
  const docx = exported.files.find(file => file.relativePath === 'paper.docx')
  if (docx?.base64) {
    await writeFile(join(outDir, 'paper.docx'), Buffer.from(docx.base64, 'base64'))
    record('docx', { path: join(outDir, 'paper.docx'), bytes: Buffer.from(docx.base64, 'base64').length })
  }
  for (const file of exported.files) if (file.text && file.relativePath.endsWith('.md')) await writeFile(join(outDir, file.relativePath), file.text)

  const after = {}
  for (const relative of Object.keys(before)) {
    const path = join(SOURCE, relative)
    after[relative] = { sha256: await hashFile(path), mtimeMs: (await stat(path)).mtimeMs }
  }
  await writeFile(join(outDir, 'originals-after.json'), JSON.stringify(after, null, 2))
  const changed = Object.keys(before).filter(key => before[key].sha256 !== after[key].sha256 || before[key].mtimeMs !== after[key].mtimeMs)
  record('originals', { checked: Object.keys(before).length, changed })
  if (docx) {
    const { spawnSync } = await import('node:child_process')
    const measured = spawnSync(process.execPath, ['scripts/measure-pagination.mjs', join(outDir, 'paper.docx'), '--json', join(outDir, 'pagination.json')],
      { encoding: 'utf8' })
    record('pagination', { exit: measured.status, out: (measured.stdout ?? '').slice(0, 900), err: (measured.stderr ?? '').slice(0, 300) })
  }
  await finish(docx ? 0 : 1)
} catch (error) {
  if (error instanceof StopRun) { /* already recorded and cleaned up */ }
  else {
    record('error', { message: error.message, stack: String(error.stack).slice(0, 600) })
    try { await finish(1) } catch { /* StopRun */ }
  }
}
