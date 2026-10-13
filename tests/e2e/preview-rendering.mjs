// Real React/Chromium check: hidden previews retain their DOM and catch up on return.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const root=resolve('.dsh-tmp/preview-rendering',String(Date.now()))
await mkdir(root,{recursive:true})
const bundle=await build({stdin:{contents:`
  import React from 'react';
  import {createRoot} from 'react-dom/client';
  import {flushSync} from 'react-dom';
  import {MarkdownView} from './src/client/markdown.tsx';
  import {projectMarkdown} from './src/core/editing/markdown.ts';
  const root=createRoot(document.getElementById('preview'));
  window.blockVisits=[];
  window.show=(source,active)=>flushSync(()=>root.render(React.createElement(MarkdownView,{
    projection:projectMarkdown(source),active,
    afterBlock:start=>{window.blockVisits.push(start);return null;}
  })));
`,resolveDir:resolve('.'),loader:'js'},bundle:true,write:false,platform:'browser',format:'iife',define:{'process.env.NODE_ENV':'"production"'}})
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const rows=[]
try{
  const page=await browser.newPage(),errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.setContent('<!doctype html><style>#preview{height:100px;overflow:auto}p{min-height:128px}</style><div id="preview"></div>')
  await page.addScriptTag({content:bundle.outputFiles[0].text})
  const original='原始段落 😀。\n\n第二段。',updated='**修改后段落 😀。**\n\n第二段仍在。'
  await page.evaluate(text=>window.show(text,true),original)
  assert.equal(await page.evaluate(()=>window.blockVisits.length),2,'each paragraph must be rendered exactly once')
  rows.push('one afterBlock call per paragraph, without duplicate root traversal')
  await page.evaluate(text=>{const pane=document.getElementById('preview');pane.scrollTop=50;window.show(text,false);pane.style.display='none';window.blockVisits=[];window.originalArticle=document.querySelector('article');window.originalParagraph=document.querySelector('p')},original)
  for(let i=0;i<5;i++)await page.evaluate(({text,i})=>window.show(text+' '+i,false),{text:updated,i})
  assert.equal(await page.evaluate(()=>window.blockVisits.length),0,'hidden text changes must not traverse the preview')
  assert.equal(await page.evaluate(()=>document.querySelector('article')===window.originalArticle&&document.querySelector('p')===window.originalParagraph),true)
  assert.match(await page.locator('article').textContent(),/原始段落/)
  rows.push('hidden updates retain the exact article and paragraph nodes without traversal')
  await page.evaluate(text=>{document.getElementById('preview').style.display='';window.show(text,true)},updated)
  assert.equal(await page.locator('#preview').evaluate(node=>node.scrollTop),50,'returning must retain the reading position')
  assert.equal(await page.locator('strong').innerText(),'修改后段落 😀。')
  assert.match(await page.locator('article').innerText(),/第二段仍在/)
  assert.equal(await page.evaluate(()=>window.blockVisits.length),2)
  rows.push('returning to preview renders the latest text and formatting once')
  assert.deepEqual(errors,[])
  await writeFile(join(root,'report.json'),JSON.stringify({checks:rows,errors},null,2))
  for(const row of rows)console.log('PASS '+row)
  console.log('Report:',join(root,'report.json'))
}finally{await browser.close()}
