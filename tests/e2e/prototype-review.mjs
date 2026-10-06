// Drives the reviewable prototype (docs/writing-experience-quality/prototype/interaction-v1.2.html)
// in a real browser and records geometry, interaction and reduced-motion behaviour.
// Read-only with respect to the repository: it only writes its own report under .dsh-tmp/.
import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const file = resolve('../docs/writing-experience-quality/prototype/interaction-v1.2.html')
const out = resolve('.dsh-tmp/prototype-review')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const rows = []
const record = (name, ok, detail) => { rows.push({ name, ok, detail }); console.log(`${ok ? '✔' : '✖'} ${name} — ${detail}`) }

async function open(viewport, options = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: options.reducedMotion })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(pathToFileURL(file).href)
  await page.waitForTimeout(1600)
  return { page, context, errors }
}

try {
  const { page, errors } = await open({ width: 1280, height: 900 })
  record('prototype loads without script errors', errors.length === 0, errors.join(' | ') || 'no page or console errors')

  // The page runs its own geometry self-check; read the verdict it produced.
  const selfCheck = await page.locator('.note', { hasText: '几何自检' }).first().innerText()
  const passed = /(\d+)\/(\d+) 通过/.exec(selfCheck)
  record('embedded geometry self-check', passed && passed[1] === passed[2], selfCheck.replace(/\n/g, ' · '))

  // Six review scenarios must all be present and reachable.
  const scenes = await page.locator('.scenario').count()
  record('all six review scenarios exist', scenes === 6, `${scenes} scenarios`)
  for (let index = 0; index < scenes; index++) {
    await page.locator(`.scenarios button[data-go="${index}"]`).click()
    await page.waitForTimeout(260)
    const visible = await page.locator(`.scenario[data-scene="${index}"]`).isVisible()
    const others = await page.locator('.scenario[data-active=true]').count()
    record(`scenario ${index + 1} switches alone`, visible && others === 1, `visible=${visible} active=${others}`)
  }

  // Rapid switching must not leave a stale overlay or blank stage (AT-65/AT-68).
  // The burst deliberately ends on the scene whose designed state is "question overlay open",
  // so the assertion is that the overlay belongs to the live scene, not that it is closed.
  await page.locator('.scenarios button[data-go="0"]').click()
  await page.waitForTimeout(200)
  for (const index of [3, 4, 2, 5, 1, 0, 4, 3]) {
    await page.locator(`.scenarios button[data-go="${index}"]`).click()
  }
  await page.waitForTimeout(420)
  const afterBurst = await page.evaluate(() => ({
    active: document.querySelectorAll('.scenario[data-active=true]').length,
    overlayText: document.getElementById('overlay').innerText.trim(),
    stageHeight: document.getElementById('middle').getBoundingClientRect().height,
    bodyText: document.getElementById('stage-body').innerText.trim().length,
  }))
  record('rapid switching leaves exactly one live scene', afterBurst.active === 1, `active=${afterBurst.active}`)
  record('rapid switching shows the live scene\'s own overlay', /需要你的决定/.test(afterBurst.overlayText),
    `overlay="${afterBurst.overlayText.slice(0, 40).replace(/\n/g, ' ')}"`)
  record('rapid switching does not blank the stage', afterBurst.stageHeight > 200 && afterBurst.bodyText > 40,
    `height=${Math.round(afterBurst.stageHeight)} text=${afterBurst.bodyText}`)

  // Overlay: repeated open/close, then measurement of the middle-pane bounds (AT-59/AT-67).
  await page.locator('.scenarios button[data-go="3"]').click()
  await page.waitForTimeout(220)
  for (let index = 0; index < 6; index++) {
    await page.locator('.scenarios button[data-go="4"]').click()
    await page.waitForTimeout(30)
    await page.locator('.scenarios button[data-go="3"]').click()
    await page.waitForTimeout(30)
  }
  await page.waitForTimeout(400)
  const overlayGeometry = await page.evaluate(() => {
    const middle = document.getElementById('middle').getBoundingClientRect()
    const side = document.querySelector('aside.pane').getBoundingClientRect()
    const overlay = document.getElementById('overlay').getBoundingClientRect()
    const scroller = document.getElementById('scroller')
    return { middleLeft: middle.left, middleRight: middle.right, middleBottom: middle.bottom,
      sideLeft: side.left, overlayLeft: overlay.left, overlayRight: overlay.right, overlayBottom: overlay.bottom,
      padBottom: parseFloat(getComputedStyle(scroller).paddingBottom) }
  })
  record('overlay stays within the middle pane after repeated toggling',
    overlayGeometry.overlayLeft >= overlayGeometry.middleLeft - 1 && overlayGeometry.overlayRight <= overlayGeometry.middleRight + 1,
    JSON.stringify(overlayGeometry))
  record('overlay never reaches the right pane', overlayGeometry.overlayRight <= overlayGeometry.sideLeft + 1,
    `overlay.right=${Math.round(overlayGeometry.overlayRight)} side.left=${Math.round(overlayGeometry.sideLeft)}`)
  record('overlay adds scroll room so the last block stays reachable', overlayGeometry.padBottom > 0, `padding-bottom=${overlayGeometry.padBottom}px`)

  // Selection flow: menu click must not start generation; submit must (AT-56/AT-57).
  await page.locator('.scenarios button[data-go="4"]').click()
  await page.waitForTimeout(260)
  await page.locator('.selection-menu button[data-act="polish"]').click()
  await page.waitForTimeout(300)
  const menuOnly = await page.evaluate(() => ({ genHidden: document.getElementById('gen').hidden,
    overlayOpen: !document.getElementById('overlay').hidden }))
  record('choosing a function does not start a model call', menuOnly.genHidden === true, JSON.stringify(menuOnly))
  record('choosing a function opens the bottom overlay', menuOnly.overlayOpen === true, `overlayOpen=${menuOnly.overlayOpen}`)

  await page.locator('#local-input').fill('')
  await page.locator('[data-act="local-submit"]').click()
  await page.waitForTimeout(300)
  const submitting = await page.evaluate(() => ({ genVisible: !document.getElementById('gen').hidden,
    sweeping: getComputedStyle(document.getElementById('gen'), '::before').animationName }))
  record('submitting with no extra instruction starts generation', submitting.genVisible === true, JSON.stringify(submitting))
  record('gradient animates while generating', submitting.sweeping === 'sf-sweep', `animation-name=${submitting.sweeping}`)

  // Interrupt during generation: stopping must end the loop and keep the original text.
  await page.locator('[data-act="stop-gen"]').click()
  await page.waitForTimeout(200)
  const stopped = await page.evaluate(() => ({
    animation: getComputedStyle(document.getElementById('gen'), '::before').animationName,
    acceptHidden: document.getElementById('accept').hidden,
    originalKept: document.getElementById('sel-target').textContent.includes('这一设计'),
  }))
  record('stop during generation ends the gradient loop', stopped.animation === 'none', `animation-name=${stopped.animation}`)
  record('stop keeps the original text and offers no accept', stopped.acceptHidden === true && stopped.originalKept === true, JSON.stringify(stopped))

  // Happy path: generate, accept in place, undo.
  await page.locator('[data-act="local-submit"]').click()
  await page.waitForTimeout(3200)
  const ready = await page.evaluate(() => ({ diffVisible: !document.getElementById('diff').hidden,
    acceptVisible: !document.getElementById('accept').hidden, animation: getComputedStyle(document.getElementById('gen'), '::before').animationName,
    phase: document.querySelector('[data-slot=gen-phase]').textContent.trim(), debug: window.__sfDebug() }))
  // The phase text is asserted too: reading #gen's visibility alone cannot tell a running
  // handler from one that threw before touching the visible parts.
  record('completion reveals the diff and stops the loop', ready.diffVisible && ready.acceptVisible && ready.animation === 'none',
    JSON.stringify(ready))
  record('completion states the candidate is not auto-applied', /未自动应用/.test(ready.phase), ready.phase)
  const beforeAccept = await page.evaluate(() => document.getElementById('sel-target').textContent)
  await page.locator('#accept').click()
  await page.waitForTimeout(300)
  const accepted = await page.evaluate(() => ({ text: document.getElementById('sel-target').textContent,
    undoVisible: !document.getElementById('undo').hidden, overlayHidden: document.getElementById('overlay').hidden }))
  record('accept replaces only the selected range', accepted.text !== beforeAccept && accepted.text.includes('该设计在同一优化框架内'), accepted.text.slice(0, 30))
  record('accept offers undo and closes the overlay', accepted.undoVisible && accepted.overlayHidden, JSON.stringify({ undo: accepted.undoVisible, closed: accepted.overlayHidden }))
  await page.locator('#undo').click()
  await page.waitForTimeout(200)
  const undone = await page.evaluate(() => document.getElementById('sel-target').textContent)
  record('undo restores the pre-accept text', undone === beforeAccept, undone.slice(0, 30))
  record('no page errors accumulated during the scripted run', errors.length === 0, errors.join(' | ') || 'none')

  // Reduced motion: gradients and spins must be static, content still visible (AT-69).
  const quiet = await open({ width: 1280, height: 900 }, { reducedMotion: 'reduce' })
  await quiet.page.locator('.scenarios button[data-go="4"]').click()
  await quiet.page.waitForTimeout(260)
  await quiet.page.locator('.selection-menu button[data-act="rewrite"]').click()
  await quiet.page.waitForTimeout(150)
  await quiet.page.locator('[data-act="local-submit"]').click()
  await quiet.page.waitForTimeout(200)
  const reduced = await quiet.page.evaluate(() => ({
    gradient: getComputedStyle(document.getElementById('gen'), '::before').animationName,
    spin: getComputedStyle(document.querySelector('.spin')).animationName,
    statusText: document.querySelector('[data-slot="gen-phase"]').textContent.trim().length,
  }))
  record('reduced motion disables the gradient loop', reduced.gradient === 'none', `animation-name=${reduced.gradient}`)
  record('reduced motion disables the spinner loop', reduced.spin === 'none', `animation-name=${reduced.spin}`)
  record('reduced motion keeps the status text visible', reduced.statusText > 4, `${reduced.statusText} characters`)
  await quiet.context.close()

  // 200% zoom, the CSS viewport halves: nothing may overflow and controls stay reachable.
  const zoom = await open({ width: 640, height: 450 })
  await zoom.page.locator('.scenarios button[data-go="0"]').click()
  await zoom.page.waitForTimeout(300)
  const zoomed = await zoom.page.evaluate(() => {
    // Only controls the user can actually see count; a hidden candidate block reports 0.
    const buttons = [...document.querySelectorAll('.scenario[data-active=true] button')].filter(b => {
      const r = b.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    })
    return { overflow: document.documentElement.scrollWidth - window.innerWidth, measured: buttons.length,
      smallest: Math.min(...buttons.map(b => b.getBoundingClientRect().height)) }
  })
  record('200% zoom has no horizontal overflow', zoomed.overflow <= 1, `overflow=${zoomed.overflow}px`)
  record('200% zoom keeps controls at a usable height', zoomed.measured > 0 && zoomed.smallest >= 24,
    `${zoomed.measured} visible controls, smallest=${Math.round(zoomed.smallest)}px`)
  await zoom.context.close()
  await browser.close()

  const failed = rows.filter(row => !row.ok)
  await writeFile(resolve(out, 'prototype-review.json'), JSON.stringify({ rows, failed: failed.length }, null, 2))
  console.log(`\nprototype review: ${rows.length - failed.length}/${rows.length} passed`)
  process.exitCode = failed.length ? 1 : 0
} catch (error) {
  await browser.close()
  console.error('prototype review failed:', error.message)
  process.exitCode = 1
}
