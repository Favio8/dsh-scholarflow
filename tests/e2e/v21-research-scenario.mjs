// TEST_ONLY pipeline evidence. These values are never real author experiments.
import assert from 'node:assert/strict'
import {expect} from '@playwright/test'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {digest} from '../../src/core/store/files.ts'
export async function runResearchScenario({page,rpc,context,taskId,workspace,out,record,dismiss,resume=false}){
  const inspect=()=>rpc('scholarflow.v1/deliveryTask.inspect',{request:{context,taskId}})
  let state
  if(!resume){
  await expect.poll(async()=>(await inspect()).task.status).toBe('waiting-input');const intake=await inspect();assert.equal(intake.task.phase,'first-draft');assert.equal(intake.task.calls.length,0);record('AT-199/203: research task waits for author results without issuing a drafting call')
  await page.reload();await dismiss();await page.locator(`[data-row-key="session:${context.sessionId}"]`).click();await page.locator('[data-node="materials"]').click()
  const results=page.getByRole('region',{name:'研究结果'});await results.locator('summary').filter({hasText:'导入结果表'}).click();await results.getByLabel('结果资料',{exact:true}).selectOption({label:'results.csv'});await results.getByLabel('实验名称',{exact:true}).fill('TEST_ONLY supplied run');await results.getByRole('button',{name:'读取字段与原值',exact:true}).click()
  await results.getByLabel('valueField',{exact:true}).selectOption('value');await results.getByLabel('metricField',{exact:true}).selectOption('metric');await results.getByLabel('unitField',{exact:true}).selectOption('unit')
  for(const [label,value]of Object.entries({'任务':'TEST_ONLY classification','数据集':'TEST_ONLY data','评测划分':'test','方法':'TEST_ONLY supplied method','实验设置':'TEST_ONLY hardware','评测协议':'TEST_ONLY protocol'}))await results.getByLabel(label,{exact:true}).fill(value)
  await results.getByRole('button',{name:'预览映射与影响',exact:true}).click();await results.getByRole('button',{name:'确认导入作者结果',exact:true}).click();await expect(results.locator('summary').filter({hasText:'TEST_ONLY supplied run'})).toBeVisible();record('G21-D: research intake uses normal UI field mapping and author confirmation')
  const current=await inspect();await rpc('scholarflow.v1/deliveryTask.action',{request:{context,taskId,action:'resume',expectedTaskRevision:current.task.revision}})
  await expect.poll(async()=>(await inspect()).task.status,{timeout:45000}).toMatch(/waiting-input|paused|failed/);state=await inspect();assert.equal(state.task.phase,'awaiting-adoption',state.task.message)
  const main=await readFile(join(workspace,'manuscript/paper.md'),'utf8');assert(!main.includes('准确率为85.0'));const candidate=await rpc('scholarflow.v1/candidate.inspect',{request:{context,taskId,candidateId:state.task.candidateId,candidateHash:state.task.candidateHash}});assert(candidate.candidate.text.includes('85.0'));assert(!candidate.candidate.text.includes('[@'));record('AT-202/203: result-driven candidate has internal paragraph support and leaves the saved manuscript protected')
  }
  await page.locator('[data-node="review"]').click();await expect(page.getByRole('button',{name:'采用修改',exact:true})).toBeEnabled()
  await page.setViewportSize({width:1024,height:900});await page.getByRole('button',{name:'采用修改',exact:true}).focus();await expect(page.getByRole('button',{name:'采用修改',exact:true})).toBeInViewport();assert(await page.locator('.sf-app').evaluate(node=>node.scrollWidth<=node.clientWidth+1));await page.screenshot({path:join(out,'research-candidate-narrow.png')})
  await page.getByRole('button',{name:'采用修改',exact:true}).focus();await page.keyboard.press('Enter');record('AT-208: final candidate is reachable at a narrow desktop width and adopts with keyboard activation')
  await page.setViewportSize({width:1600,height:1000})
  await expect.poll(async()=>(await inspect()).task.phase,{timeout:30000}).toBe('finished');state=await inspect();const review=await rpc('scholarflow.v1/review.inspect',{request:{context}});assert.equal(review.report.checks.find(check=>check.id==='own_research_results').status,'pass');assert.equal(review.report.checks.find(check=>check.id==='own_result_numbers').status,'pass');record('AT-204: saved result text, exact measurements and final author adoption are rechecked together')
  const delivery=await rpc('scholarflow.v1/export.read',{request:{context,deliveryId:state.task.deliveryId}}),tex=delivery.files.find(file=>file.relativePath==='paper.tex'),support=delivery.files.find(file=>file.relativePath==='research-support.json'),bib=delivery.files.find(file=>file.relativePath==='references.bib')
  assert(tex.text.includes('85.0'));assert.equal(bib.text.split(/\r?\n/u).filter(line=>line.trim()&&!line.trim().startsWith('%')).length,0);assert.equal(JSON.parse(support.text).experiments[0].measurements[0].measurement.value,'85.0');assert(!delivery.files.some(file=>file.relativePath==='results.csv'));record('AT-198/202: actual LaTeX and internal support manifest share the adopted snapshot without invented bibliography or raw-log export')
  await page.screenshot({path:join(out,'research-delivery.png')})
  const adopted=await readFile(join(workspace,'manuscript/paper.md'),'utf8'),manual=adopted+'\nTEST_ONLY 人工限定：仅适用于作者提供的测试设置。\n',ledgerPath=join(workspace,'.scholarflow/data/ledger.json')
  await rpc('scholarflow.v1/document.saveManual',{request:{context:{...context,expectedLedgerRevision:JSON.parse(await readFile(ledgerPath,'utf8')).revision},text:manual,baseHash:digest(adopted)}})
  await writeFile(join(workspace,'results.csv'),'metric,value,unit\r\naccuracy,86.0,%\r\n')
  await page.reload();await dismiss();await page.locator(`[data-row-key="session:${context.sessionId}"]`).click();await page.locator('[data-node="materials"]').click()
  const updated=page.getByRole('region',{name:'研究结果'});await updated.locator('summary').filter({hasText:'TEST_ONLY supplied run'}).click();await updated.getByRole('button',{name:'更新结果与配置',exact:true}).click();await updated.getByRole('button',{name:'读取字段与原值',exact:true}).click()
  await updated.getByLabel('valueField',{exact:true}).selectOption('value');await updated.getByLabel('metricField',{exact:true}).selectOption('metric');await updated.getByLabel('unitField',{exact:true}).selectOption('unit')
  for(const [label,value]of Object.entries({'任务':'TEST_ONLY classification','数据集':'TEST_ONLY data','评测划分':'test','方法':'TEST_ONLY supplied method','实验设置':'TEST_ONLY hardware','评测协议':'TEST_ONLY protocol'}))await updated.getByLabel(label,{exact:true}).fill(value)
  await updated.getByRole('button',{name:'预览映射与影响',exact:true}).click();await expect(updated.getByRole('region',{name:'结果映射预览'})).toContainText('86.0');await updated.getByRole('button',{name:'确认导入作者结果',exact:true}).click();await expect(updated.locator('summary').filter({hasText:'版本 2'})).toBeVisible()
  assert.equal(await readFile(join(workspace,'manuscript/paper.md'),'utf8'),manual)
  await page.locator('[data-node="review"]').click();await page.locator('summary').filter({hasText:'按当前输入重新预览任务'}).click();await page.getByRole('button',{name:'预览本次任务',exact:true}).click();await page.getByRole('button',{name:'确认停止旧任务并按新计划继续',exact:true}).click()
  const inspectNew=()=>rpc('scholarflow.v1/deliveryTask.inspect',{request:{context}})
  await expect.poll(async()=>(await inspectNew()).task.id).not.toBe(taskId);await expect.poll(async()=>(await inspectNew()).task.phase,{timeout:45000}).toBe('awaiting-adoption')
  const next=await inspectNew();assert.equal(await readFile(join(workspace,'manuscript/paper.md'),'utf8'),manual)
  const preview=await rpc('scholarflow.v1/candidate.inspect',{request:{context,taskId:next.task.id,candidateId:next.task.candidateId,candidateHash:next.task.candidateHash}});assert(preview.candidate.text.includes('86.0'));assert(preview.candidate.text.includes('TEST_ONLY 人工限定'));assert(preview.claimChanges.length>0)
  await expect(page.getByRole('button',{name:'采用修改',exact:true})).toBeEnabled();await page.getByRole('button',{name:'采用修改',exact:true}).click();await expect.poll(async()=>(await inspectNew()).task.phase,{timeout:30000}).toBe('finished')
  const persisted=JSON.parse(await readFile(ledgerPath,'utf8'));assert(Object.values(persisted.evidence).some(e=>e.measurement?.value==='85.0'&&e.validation==='stale'));assert(Object.values(persisted.evidence).some(e=>e.measurement?.value==='86.0'&&e.validation==='located'))
  const revised=await readFile(join(workspace,'manuscript/paper.md'),'utf8');assert(revised.includes('86.0%')&&revised.includes('TEST_ONLY 人工限定'));assert(!revised.includes('85.0%'));record('AT-205: normal UI result update replans, previews claim changes and atomically adopts current values while preserving manual text and historical evidence')
  await expect(page.getByRole('region',{name:'连续任务的检查与交付'})).toContainText('交付文件已保存');await page.screenshot({path:join(out,'research-update.png')})
}
