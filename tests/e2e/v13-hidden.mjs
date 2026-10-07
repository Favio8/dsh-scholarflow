import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'

// Native window state and renderer state are sampled together, without a locator
// bringing a hidden window back into focus. No real provider call is made.
export async function hiddenCheck({page,app,setup}) {
  const out=join(setup.root,'hidden-motion');await mkdir(out,{recursive:true})
  const area=page.locator('.sf-source-input'),original=await area.inputValue()
  await area.press('Control+Home')
  await area.evaluate(e=>{const s=e.value.indexOf('\n\n',e.value.indexOf('## '))+2;e.focus();e.setSelectionRange(s,e.value.indexOf('\n\n',s))})
  await area.dispatchEvent('mouseup');await page.getByRole('button',{name:'润色',exact:true}).click()
  await page.evaluate(()=>{const original=window.fetch;window.__sfHiddenProbe={original,count:0};window.fetch=async(input,init)=>{
    if(String(input).endsWith('api/scholarflow.v1/cowrite.propose')){const m=JSON.parse(init.body);window.__sfHiddenProbe.count++;await new Promise(r=>setTimeout(r,8000));return new Response(JSON.stringify({type:'server-response',rpcId:m.rpcId,result:{ok:true,value:{ok:false,error:{code:'TRANSPORT',message:'TEST_ONLY slow response',details:{category:'provider/transport'}}}}}),{headers:{'content-type':'application/json'}})}
    return Reflect.apply(original,window,[input,init])}})
  try {
    const input=page.getByRole('textbox',{name:'局部修改要求'});await input.fill('TEST_ONLY 隐藏与停止');await input.press('Enter');await page.locator('.sf-rewrite[data-state=generating]').waitFor()
    const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:false})
    const native=async(action)=>app.evaluate(async({BrowserWindow},action)=>{
      const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('dsh-app://app/'))
      if(action==='show'){w.restore();w.show();w.focus()}else if(action==='hide')w.hide()
      await new Promise(r=>setTimeout(r,300))
      return {visible:w.isVisible(),focused:w.isFocused(),renderer:await w.webContents.executeJavaScript('({hidden:document.hidden,focus:document.hasFocus(),root:document.querySelector(".sf-app").dataset.sfHidden,pause:getComputedStyle(document.querySelector(".sf-rewrite-sweep"),"::before").animationPlayState,requests:window.__sfHiddenProbe.count})')}
    },action)
    const visible=await native('show'),hidden=await native('hide'),restored=await native('show')
    await writeFile(join(out,'native-state.json'),JSON.stringify({visible,hidden,restored},null,2))
    assert.equal(hidden.visible,false);assert.equal(hidden.renderer.pause,'paused');assert.equal(hidden.renderer.requests,1);assert.equal(restored.renderer.requests,1)
    await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.sf-rewrite-sweep').evaluate(e=>getComputedStyle(e,'::before').animationName),'none');await page.screenshot({path:join(out,'reduced-generating.png')})
    await page.getByRole('button',{name:'停止生成',exact:true}).click();await page.locator('.sf-rewrite[data-state=stopped]').waitFor();await page.waitForTimeout(8500);assert.equal(await page.locator('.sf-rewrite').getAttribute('data-state'),'stopped');assert.equal(await area.inputValue(),original)
    await writeFile(join(out,'result.json'),JSON.stringify({nativePause:true,reducedMotion:true,requests:1,lateResponseIgnored:true,bodyUnchanged:true},null,2))
    return {out,hidden,restored}
  }finally{await page.evaluate(()=>{window.fetch=window.__sfHiddenProbe.original;delete window.__sfHiddenProbe});await page.emulateMedia({reducedMotion:'no-preference'});await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('dsh-app://app/'));w.restore();w.show();w.focus()})}
}
