import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import assert from 'node:assert/strict'
export async function projects({page,setup,rpc}) {
  const rows=[],api=async(method,args)=>{const r=await rpc(method,args);if(!r.ok||r.value?.ok===false)throw Error(JSON.stringify(r.error??r.value.error));return r.value?.data??r.value}
  for(const [type,label] of [['course-paper','课程论文'],['literature-review','文献综述'],['research-paper','研究论文']]){
    const path=join(setup.root,type+' TEST_ONLY');await mkdir(path,{recursive:true});const w=await api('workspace/create',{request:{path}}),workspaceId=w.workspace.workspaceId
    await page.reload();await page.locator(`[data-row-key="workspace:${workspaceId}"]`).hover();await page.getByRole('button',{name:new RegExp(type+' TEST_ONLY.*中新建会话')}).click()
    await page.locator('button[title="选择新任务使用的 Agent 预设"]').click();await page.locator('[class*="_item_"]').filter({hasText:/^ScholarFlow/}).click();await page.locator('.sf-wizard').waitFor()
    const sessionId=await page.locator('.sf-project').getAttribute('data-sf-session-id'),context={requestId:'v13_'+type,workspaceId,sessionId}
    const plan=await api('scholarflow.v1/project.prepareInit',{request:{context,input:{title:type+' TEST_ONLY',type}}});await api('scholarflow.v1/project.initialize',{request:{context,planId:plan.planId,planHash:plan.planHash}})
    await page.reload();await page.getByRole('button',{name:label+' ▾',exact:true}).click();const length=page.getByRole('spinbutton',{name:'目标篇幅'});assert.equal(await length.inputValue(),'','no template 4000')
    await page.getByRole('textbox',{name:'写作要求',exact:true}).fill('TEST_ONLY 约1500字，保持已有资料与封面范围。');await length.fill('1500');await page.getByRole('button',{name:'添加章节结构',exact:true}).click();await page.getByRole('button',{name:'保存要求',exact:true}).click();await page.getByText('已保存写作要求。',{exact:true}).waitFor()
    await page.reload();await page.getByRole('button',{name:label+' ▾',exact:true}).click();assert.equal(await length.inputValue(),'1500')
    const read=await api('scholarflow.v1/writingTask.requirements',{request:{context}}),state=await api('scholarflow.v1/writingTask.inspect',{request:{context}});assert.equal(read.spec.type,type);assert.equal(state.task,undefined);assert.equal('id' in read.spec,false)
    rows.push({type,sessionId,noTask:true,explicit1500:true,preservedType:true,noModelCalls:true});console.log('PASS project',type)
  }
  await page.locator(`[data-row-key="session:${setup.testSessionId}"]`).click();await page.locator('.sf-source-input').waitFor();await writeFile(join(setup.root,'additional/project-types.json'),JSON.stringify(rows,null,2));return rows
}
