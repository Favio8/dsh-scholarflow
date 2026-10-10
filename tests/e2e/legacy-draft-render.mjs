// TEST_ONLY: reproduce a stopped pre-v1.10 task in the real progress and editor components.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { sourceConflictFixture } from '../fixtures/source-conflict.ts'
import { snapshot } from '../../src/core/project/project.ts'

const out = resolve('.dsh-tmp/legacy-draft-render', String(Date.now())); await mkdir(out, { recursive: true })
const f = await sourceConflictFixture()
const project = { ...await snapshot(f.io), binding: { projectId: f.task.projectId, sessionId: f.task.sessionId, workspaceId: 'workspace_TEST_ONLY', rootFingerprint: 'TEST_ONLY' } }
const task = { ...f.task, status: 'cancelled', questions: [{ id: 'question_TEST_ONLY', kind: 'failure', title: 'TEST_ONLY historical duplicate question', options: ['继续'] }] }
delete task.mode // The user's stored task predates this field.
await build({ stdin: { resolveDir: resolve('.'), loader: 'tsx', contents: `
import React from 'react';import{createRoot}from'react-dom/client';import{Draft}from'./src/client/draft.tsx';import{WritingProgress,PROGRESS_CSS}from'./src/client/writing-progress.tsx';import{THEME_CSS}from'./src/client/theme/tokens.ts';
const project=${JSON.stringify(project)};let task=${JSON.stringify(task)};const root=createRoot(document.getElementById('app'));
window.fixture={actions:[],reads:0};const context=()=>({requestId:'req_TEST_ONLY',workspaceId:'workspace_TEST_ONLY',sessionId:task.sessionId,projectId:task.projectId});
const api=async(name,input)=>{
 if(name==='writingTask.inspect'){window.fixture.reads++;return{task}}
 if(name==='writingTask.watch')return{};if(name==='writingTask.unwatch')return{};
 if(name==='writingTask.action'){window.fixture.actions.push(input.action);await new Promise(done=>window.fixture.finish=done);task={...task,mode:'first-draft',status:'paused',revision:task.revision+1};return{task}}
 if(name==='editor.bufferRead')return{bufferHash:null};if(name==='cowrite.list')return{suggestions:[],briefs:[]};if(name==='runs.list')return{runs:[],diagnostics:[]};if(name==='skills.project')return{resources:[]};if(name==='draftSequence.inspect')return{};throw Error('TEST_ONLY unexpected '+name)
};window.fixture.setStatus=status=>{task={...task,status}};
root.render(<div className="sf-app"><style>{THEME_CSS+PROGRESS_CSS}</style><WritingProgress api={api} context={context} refresh={async()=>{}}/><Draft project={project} generationMode="guided" api={api} context={context} refresh={async()=>{}} run={fn=>void fn()} busy={false} view="preview"/></div>);
` }, outfile: join(out, 'app.js'), bundle: true, platform: 'browser', format: 'iife', define: { __SF_KATEX_CSS__: '""' } })
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html;charset=utf-8')
  res.end(req.url === '/app.js' ? await readFile(join(out, 'app.js')) : '<!doctype html><meta charset="utf-8"><div id="app"></div><script src="/app.js"></script>')
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await browser.newPage(), errors = [], results = []
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto('http://127.0.0.1:' + server.address().port)
  await expect(page.locator('.sf-writing-progress')).toContainText('旧版写作已停止')
  const upgrade = page.getByRole('button', { name: '按新方式继续初稿', exact: true })
  await expect(upgrade).toBeVisible()
  await page.waitForFunction(() => window.fixture.reads >= 4)
  assert.equal(await page.locator('.sf-overlay-question').count(), 0)
  assert.deepEqual(await page.evaluate(() => window.fixture.actions), [])
  results.push('stopped legacy task retains explicit upgrade entry; repeated polling opens no historical question or paid request')
  // Guided waiting tasks keep their existing question behavior.
  await page.evaluate(() => window.fixture.setStatus('waiting-input'))
  await expect(page.locator('.sf-overlay-question')).toContainText('TEST_ONLY historical duplicate question')
  await page.evaluate(() => window.fixture.setStatus('cancelled'))
  await expect(page.locator('.sf-overlay-question')).toHaveCount(0)
  results.push('guided waiting question remains usable; stopping removes it on the next observation')
  await upgrade.click()
  await expect(upgrade).toBeDisabled()
  await upgrade.evaluate(button => { button.click(); button.click() })
  assert.deepEqual(await page.evaluate(() => window.fixture.actions), ['start-first-draft'])
  await page.evaluate(() => window.fixture.finish())
  await expect(upgrade).toHaveCount(0)
  await expect(page.locator('.sf-writing-progress')).toContainText('已暂停，可编辑已保存正文')
  results.push('one explicit click selects first-draft once; pending command disables duplicate dispatch')
  assert.deepEqual(errors, [])
  await page.screenshot({ path: join(out, 'legacy-recovery.png') })
  console.log(JSON.stringify({ results, errors, out }, null, 2))
} finally {
  await writeFile(join(out, 'report.json'), JSON.stringify({ results, errors }, null, 2))
  await browser.close(); await new Promise(done => server.close(done))
}
