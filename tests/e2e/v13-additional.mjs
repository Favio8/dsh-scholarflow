import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises'
import {join} from 'node:path'
import JSZip from 'jszip'
export async function additional({page,app,setup,rpc,onlyTail=false,finalOnly=false}) {
  const out=join(setup.root,'additional');await mkdir(out,{recursive:true});const rows=[]
  const record=(id,detail)=>{rows.push({id,at:new Date().toISOString(),detail});console.log('PASS',id,JSON.stringify(detail))}
  const ctx=()=>({requestId:'v13_extra_'+Date.now(),workspaceId:setup.workspaceId,sessionId:setup.testSessionId})
  const api=async(method,request)=>{const r=await rpc('scholarflow.v1/'+method,{request});if(!r.ok||r.value?.ok===false)throw Error(JSON.stringify(r.error??r.value.error));return r.value?.data??r.value}
  const a=page.locator('.sf-source-input');await a.waitFor();const original=await a.inputValue()
  const taskFile=join(setup.workspace,'.scholarflow/writing/tasks',setup.taskId+'.json'),taskBytes=await readFile(taskFile,'utf8'),pointerFile=join(setup.workspace,'.scholarflow/writing/current.json'),pointerBytes=await readFile(pointerFile,'utf8')
  let originalFetch
  try {
    if(!onlyTail&&!finalOnly){
    const spec=(await api('writingTask.requirements',{context:ctx()})).spec
    const invalid=await rpc('scholarflow.v1/writingTask.requirements',{request:{context:{...ctx(),projectId:'prj_wrong_TEST_ONLY'}}});assert.equal(invalid.value.ok,false)
    const other=JSON.parse(taskBytes);other.projectId='prj_wrong_TEST_ONLY';await writeFile(taskFile,JSON.stringify(other));assert.deepEqual((await api('writingTask.requirements',{context:ctx()})).spec,spec)
    await writeFile(taskFile,'{corrupt TEST_ONLY');assert.deepEqual((await api('writingTask.requirements',{context:ctx()})).spec,spec)
    await writeFile(taskFile,taskBytes);await writeFile(pointerFile,JSON.stringify({taskId:setup.taskId,projectId:'prj_wrong_TEST_ONLY'}));assert.deepEqual((await api('writingTask.requirements',{context:ctx()})).spec,spec)
    await writeFile(pointerFile,pointerBytes);record('AT-79/independent',{wrongRequestRejected:true,wrongTaskDoesNotBlockRequirements:true,damagedTaskDoesNotBlock:true,wrongPointerDoesNotBlock:true})
    await page.getByRole('button',{name:'课程论文 ▾',exact:true}).click();const title=page.getByRole('textbox',{name:'论文标题'}),prior=await title.inputValue();await title.fill(prior+' VERSION_TEST_ONLY')
    await page.getByRole('button',{name:'保存要求',exact:true}).click();await page.getByText('已保存写作要求。',{exact:true}).waitFor();await page.reload();await page.getByRole('button',{name:'课程论文 ▾',exact:true}).click();assert.equal(await title.inputValue(),prior+' VERSION_TEST_ONLY')
    await title.fill(prior);await page.getByRole('button',{name:'保存要求',exact:true}).click();await page.getByText('已保存写作要求。',{exact:true}).waitFor()
    await page.getByRole('spinbutton',{name:'目标篇幅'}).fill('0');await page.getByRole('button',{name:'保存要求',exact:true}).click();await page.getByText('目标篇幅需要填写有效整数（200～60000）。',{exact:true}).waitFor();assert.equal(await page.getByRole('spinbutton',{name:'目标篇幅'}).inputValue(),'0');await page.getByRole('spinbutton',{name:'目标篇幅'}).fill(String(spec.targetLength))
    assert.equal(await page.getByText('目标篇幅需要填写有效整数（200～60000）。',{exact:true}).count(),0);record('AT-77/80',{reopenSavedValue:true,invalidFieldLocated:true,failedInputRetained:true,errorClearedOnEdit:true})
    }
    if(!finalOnly){await page.locator('.sf-paper-views').getByRole('button',{name:'分屏',exact:true}).click();await page.getByRole('button',{name:'编辑恢复100%',exact:true}).click();await page.getByRole('button',{name:'预览恢复100%',exact:true}).click()
    // Small unsaved TEST_ONLY prose is solely a geometry fixture; it is never sent to a model.
    const citation='sf_080f7aa59c63',fixture=`# TEST_ONLY\n\n第一段：连续选文与引用 [@${citation}]。\n\n第二段：普通相邻段落可以连续选择。\n\n第三段：保留后续正文。\n`
    await a.fill(fixture);await page.waitForTimeout(150)
    const sourceBytes=await readFile(join(setup.workspace,'manuscript/paper.md'),'utf8'),canonicalFixture=sourceBytes.includes('\r\n')?fixture.replace(/\n/g,'\r\n'):fixture
    for(const pair of onlyTail?[[.5,2]]:[[1,1],[1.25,.85],[.5,2]]){
      await page.getByRole('button',{name:'编辑恢复100%',exact:true}).click();await page.getByRole('button',{name:'预览恢复100%',exact:true}).click()
      for(const [node,value] of [[a,pair[0]],[page.locator('.sf-paper-scroll'),pair[1]]]){const b=await node.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+80);await page.keyboard.down('Control');await page.mouse.wheel(0,Math.round((1-value)*2000));await page.keyboard.up('Control');await page.waitForTimeout(100)}
      const scroll=page.locator('.sf-paper-scroll'),sb=await scroll.boundingBox();await page.mouse.move(sb.x+sb.width/2,sb.y+60);await page.mouse.wheel(-5000,0);await page.waitForTimeout(150)
      const p=page.locator('.sf-paper-page .sf-prose>p');const points=await p.evaluateAll(es=>{const edge=(e,end)=>{const leaf=e.querySelector('[data-sf-leaf]'),node=leaf.firstChild,r=document.createRange(),offset=end?3:0;r.setStart(node,offset);r.setEnd(node,offset+1);const b=r.getBoundingClientRect();return{x:b.x+(end?b.width-1:1),y:b.y+b.height/2}};return{start:edge(es[0],false),end:edge(es[1],true)}})
      await page.mouse.move(points.start.x,points.start.y);await page.mouse.down();await page.mouse.move(points.end.x,points.end.y,{steps:12});await page.mouse.up();await page.getByRole('button',{name:'润色',exact:true}).waitFor();await page.getByRole('button',{name:'润色',exact:true}).click()
      const range=await page.evaluate(()=>{const k=Object.keys(localStorage).find(k=>k.endsWith(':rewrite'));return JSON.parse(localStorage.getItem(k)).editRange})
      assert.equal(canonicalFixture.slice(range.start,range.end).startsWith('第一段'),true);assert.equal(canonicalFixture.slice(range.start,range.end).includes(`[@${citation}]`),true);assert.equal(canonicalFixture.slice(range.start,range.end).includes('第二段'),true)
      await page.getByRole('textbox',{name:'局部修改要求'}).press('Escape');await page.screenshot({path:join(out,`selection-${pair.join('-')}.png`)});record('AT-72/'+pair.join('/'),{type:'actual Electron mouse drag + readonly range inspection',range})
    }
    await a.fill(original);await page.getByRole('button',{name:'编辑恢复100%',exact:true}).click();await page.getByRole('button',{name:'预览恢复100%',exact:true}).click()
    }
    if(!await page.locator('.sf-agent').isVisible()){const toggle=page.getByRole('button',{name:'打开右侧边栏',exact:true});if(await toggle.isVisible())await toggle.click();await page.locator('.sf-agent,.sf-chat-guide').first().waitFor();if(await page.locator('.sf-chat-guide').isVisible())await page.locator('.sf-chat-guide').click();await page.locator('.sf-agent [data-composer-input]').waitFor()}
    // Host's 200% responsive dock is fullscreen; its close control returns to the manuscript.
    await app.evaluate(({webContents})=>{for(const w of webContents.getAllWebContents().filter(w=>w.getType()==='window'))w.setZoomFactor(2)})
    await page.getByRole('button',{name:'关闭聊天面板',exact:true}).click();await a.waitFor();await page.screenshot({path:join(out,'host-200-manuscript.png')});const toolbar=await page.locator('.sf-paper-header').boundingBox();assert.ok(toolbar.height<60)
    await app.evaluate(({webContents})=>{for(const w of webContents.getAllWebContents().filter(w=>w.getType()==='window'))w.setZoomFactor(1)})
    await page.getByRole('button',{name:'打开右侧边栏',exact:true}).click();record('AT-83/host-200',{nativeFullscreenDock:true,manuscriptReturn:true,headerHeight:toolbar.height})
    const wordPath=join(out,'legacy-export.docx');await app.evaluate(({session},path)=>{session.defaultSession.once('will-download',(_event,item)=>item.setSavePath(path))},wordPath)
    await page.locator('.sf-export-split>button').click()
    // Desktop owns the download; its renderer does not emit Playwright's event.
    const deadline=Date.now()+15000
    while(!(await stat(wordPath).catch(()=>undefined))?.size){assert.ok(Date.now()<deadline,'native DOCX download did not finish');await page.waitForTimeout(100)}
    const zip=await JSZip.loadAsync(await readFile(wordPath)),xml=await zip.file('word/document.xml').async('string'),styles=await zip.file('word/styles.xml').async('string');assert.match(xml+styles,/w:eastAsia="宋体"/);assert.match(xml,/w:line="288"/);assert.match(xml,/w:pgSz w:w="11906" w:h="16838"/)
    assert.equal(await a.inputValue(),original);record('AT-71/85/export',{type:'actual Electron export + DOCX inspection',bodyUnchanged:true,fontsSpacingA4:true,wordPath})
    await writeFile(join(out,'result.json'),JSON.stringify({rows},null,2));return{out,rows}
  }catch(e){await page.screenshot({path:join(out,'failure.png')});await writeFile(join(out,'failure.json'),JSON.stringify({error:e.message,rows},null,2));throw e}
  finally{await app.evaluate(({webContents})=>{for(const w of webContents.getAllWebContents().filter(w=>w.getType()==='window'))w.setZoomFactor(1)});await writeFile(taskFile,taskBytes);await writeFile(pointerFile,pointerBytes);await a.fill(original).catch(()=>{});await page.waitForTimeout(500)}
}
