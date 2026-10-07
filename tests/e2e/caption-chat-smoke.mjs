// Actual running Electron Desktop, started with --remote-debugging-port=19352.
// Does not create projects, send prompts or modify workspace files.
import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const browser = await chromium.connectOverCDP('http://127.0.0.1:19352')
const page = browser.contexts()[0].pages().find(p => !p.url().startsWith('devtools:'))
assert.ok(page, 'Desktop renderer is available')
page.setDefaultTimeout(15000)
const out = resolve('.dsh-tmp/ui-refinement')
await mkdir(out, { recursive: true })
let originalDraft, cdp
const input = page.locator('.sf-agent [data-composer-input]')
async function replaceDraft(text) {
  // Native Lexical owns editor state; direct DOM fill is not a reliable clear.
  await input.press('Control+a'); await input.press('Backspace')
  if (text) await input.pressSequentially(text)
  await page.waitForFunction(value => document.querySelector('.sf-agent [data-composer-input]')?.innerText.trimEnd() === value.trimEnd(), text)
}
const errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  const entry = page.locator('.sf-caption-entry button')
  await entry.waitFor()
  assert.equal(await entry.innerText(), 'ScholarFlow')
  assert.equal(await page.locator('button[aria-label="ScholarFlow"]').count(), 1)
  await entry.click()
  await page.getByRole('status').filter({ hasText: '已连接 Host' }).waitFor()
  const pane = page.locator('.sf-agent')
  if (!await pane.isVisible()) await page.getByRole('button', { name: '展开当前会话面板', exact: true }).click()
  const caption = await page.evaluate(() => {
    const box = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, height: r.height } }
    return { menu: box(document.querySelector('[data-windows-menu]')), entry: box(document.querySelector('.sf-caption-entry')),
      appRegion: getComputedStyle(document.querySelector('.sf-caption-entry')).webkitAppRegion }
  })
  assert.ok(caption.entry.x >= caption.menu.right && caption.entry.x - caption.menu.right <= 8, 'entry follows actual Desktop menu')
  assert.equal(caption.entry.y, 0)
  assert.equal(caption.appRegion, 'no-drag')
  const compositor = pane.locator('[data-conversation-content]')
  assert.equal(await compositor.getAttribute('data-content-phase'), 'active')
  assert.equal(await pane.getByText('探索未至之境').count(), 0)
  const geometry = async () => {
    const bounds = await pane.boundingBox(), input = await pane.locator('[data-composer-card]').boundingBox()
    assert.ok(input.x >= bounds.x && input.x + input.width <= bounds.x + bounds.width + 1, 'composer fits pane')
    assert.ok(input.y > bounds.y + bounds.height / 2, 'composer is in bottom half')
    assert.ok(bounds.y + bounds.height - input.y - input.height < 90, 'composer stays near panel bottom')
    return { pane: bounds, input }
  }
  const desktop = await geometry()
  originalDraft = await input.innerText()
  await replaceDraft('UI TEST_ONLY — 保留未提交输入')
  await pane.getByRole('button', { name: '关闭聊天面板', exact: true }).click()
  assert.equal(await pane.isVisible(), false)
  await page.getByRole('button', { name: '展开当前会话面板', exact: true }).click()
  assert.equal(await input.innerText(), 'UI TEST_ONLY — 保留未提交输入')
  await replaceDraft(originalDraft)
  const separator = page.getByRole('separator', { name: '调整当前会话面板宽度' })
  await separator.focus(); await separator.press('ArrowLeft')
  await geometry()
  await page.screenshot({ path: resolve(out, 'desktop.png') })
  cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 720, height: 760, deviceScaleFactor: 1, mobile: false })
  await page.locator('.sf-app[data-sf-narrow="true"]').waitFor()
  await page.getByRole('button', { name: '展开当前会话面板', exact: true }).click()
  const narrow = await geometry()
  await page.screenshot({ path: resolve(out, 'narrow.png') })
  await pane.getByRole('button', { name: '返回论文工作台', exact: true }).click()
  assert.equal(await page.locator('.sf-body').isVisible(), true)
  await cdp.send('Emulation.clearDeviceMetricsOverride')
  await page.locator('.sf-app[data-sf-narrow="false"]').waitFor()
  assert.deepEqual(errors, [])
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ caption, desktop, narrow, errors, checks: ['one caption entry', 'native menu anchor', 'native embedded composer at bottom', 'hero omitted', 'draft retained on collapse', 'keyboard resize', 'narrow chat and return'] }, null, 2))
  console.log('Actual Desktop caption/chat layout passed; artifacts: .dsh-tmp/ui-refinement')
} finally {
  if (cdp) await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {})
  if (originalDraft !== undefined) {
    if (!await page.locator('.sf-agent').isVisible()) await page.getByRole('button', { name: '展开当前会话面板', exact: true }).click()
    await replaceDraft(originalDraft)
  }
  await browser.close()
}
