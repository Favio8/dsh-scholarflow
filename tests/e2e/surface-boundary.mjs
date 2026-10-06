// Verifies the surface boundary: a throw inside the project surface must render a readable
// failure with a way back, not an empty pane.
//
// The project surface replaces the Host's conversation slot, so before this boundary existed an
// exception anywhere inside it unmounted the subtree and left a blank main area with no message
// and no route back to an ordinary conversation. The fix is only worth having if the boundary
// itself works, so this mounts it with a deliberately throwing child and asserts what appears.
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { build } from 'esbuild'

const out = resolve('.dsh-tmp/boundary-check')
mkdirSync(out, { recursive: true })

const entry = `import React from 'react'
import { createRoot } from 'react-dom/client'
import { SurfaceBoundary, SURFACE_BOUNDARY_CSS } from '${resolve('src/client/surface-boundary.tsx').replace(/\\/g, '/')}'
function Boom(): React.ReactElement { throw new Error('TEST_ONLY 故意抛错，用于验证边界') }
function App() {
  const [escape, setEscape] = React.useState('')
  return <><style>{SURFACE_BOUNDARY_CSS}</style>
    <SurfaceBoundary label="项目面" onEscape={() => setEscape('已交还给普通对话')}>
      {escape ? <p id="escaped">{escape}</p> : <Boom />}
    </SurfaceBoundary></>
}
createRoot(document.getElementById('root')!).render(<App />)
`
writeFileSync(join(out, 'entry.tsx'), entry)
writeFileSync(join(out, 'index.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>boundary</title></head><body><div id="root"></div><script src="bundle.js"></script></body></html>')
// The JS API avoids spawning a shell shim, which Node refuses for .cmd without a shell.
await build({ entryPoints: [join(out, 'entry.tsx')], bundle: true, outfile: join(out, 'bundle.js'),
  loader: { '.tsx': 'tsx' }, format: 'iife', logLevel: 'error' })

const browser = await chromium.launch({ executablePath: process.env.SCHOLARFLOW_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await (await browser.newContext()).newPage()
const consoleErrors = []
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
await page.goto('file://' + join(out, 'index.html').replace(/\\/g, '/'))
await page.waitForTimeout(900)

const shown = await page.evaluate(() => {
  const el = document.querySelector('.sf-boundary')
  return { present: Boolean(el), heading: el?.querySelector('h3')?.textContent ?? '',
    message: el?.querySelector('pre')?.textContent ?? '',
    buttons: [...(el?.querySelectorAll('button') ?? [])].map(button => button.textContent),
    blank: !el && (document.body.innerText ?? '').trim() === '' }
})
console.log('边界出现:', shown.present, '| 白屏:', shown.blank)
console.log('标题:', shown.heading)
console.log('错误信息:', shown.message)
console.log('按钮:', JSON.stringify(shown.buttons))

const clicked = await page.evaluate(() => {
  const button = [...document.querySelectorAll('.sf-boundary button')].find(el => el.textContent.includes('返回普通对话'))
  button?.click()
  return Boolean(button)
})
await page.waitForTimeout(700)
const escaped = await page.evaluate(() => document.getElementById('escaped')?.textContent ?? '(未恢复)')
console.log('逃生按钮:', clicked, '| 点击后:', escaped)
// componentDidCatch logs the component stack, which is the part a user can copy back.
console.log('组件栈已记入 console:', consoleErrors.some(line => line.includes('项目面')))
await browser.close()

const problems = []
if (!shown.present) problems.push('抛出后没有渲染边界（白屏）')
if (shown.blank) problems.push('主面为空')
if (!shown.heading.includes('出错')) problems.push('没有可读的标题')
if (!shown.message.includes('TEST_ONLY')) problems.push('没有显示真实错误信息')
if (shown.buttons.length !== 2) problems.push('重试或逃生按钮缺失')
if (!clicked || !escaped.includes('交还')) problems.push('逃生按钮无效')
if (!consoleErrors.some(line => line.includes('项目面'))) problems.push('组件栈未记入 console')

if (problems.length) {
  console.error(`\n${problems.length} 项边界检查失败：`)
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}
console.log('\n✔ 边界验证通过：抛出时显示可读错误与逃生按钮，并把组件栈记入 console。')
