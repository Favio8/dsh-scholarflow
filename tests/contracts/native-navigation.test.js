import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'

const bundle = await build({ entryPoints: ['src/client/native-dock.tsx'], bundle: true, write: false,
  platform: 'node', format: 'esm', packages: 'external' })
// Resolve React relative to this repository while loading the controller in memory.
const code = bundle.outputFiles[0].text.replace('from "react"', `from ${JSON.stringify(import.meta.resolve('react'))}`)
const { createWorkbenchNavigation } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

function observable(value) {
  const listeners = new Set()
  return { getSnapshot: () => value, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
    set(next) { value = next; for (const fn of [...listeners]) fn() } }
}
function fixture(preset = 'scholarflow') {
  let cancellation = new AbortController()
  const disposers = [], entries = new Set()
  const current = observable({ key: 'A' }), selection = observable({ sessionId: 'A' })
  const list = observable({ byId: { A: { blank: true, projectionValues: { agentPreset: preset } },
    B: { blank: true, projectionValues: { agentPreset: 'standard' } } } })
  const panelInfo = observable({ activePanelId: null })
  const ctx = { uiSession: { adapter: { current } }, uiWorkspace: { selection }, sessions: { list },
    layout: { panelInfo, selectPanel(id) { cancellation.abort(); panelInfo.set({ activePanelId: id }) },
      beginNavigation() { cancellation.abort(); cancellation = new AbortController(); return cancellation.signal } },
    sidebarRight: { mounted: observable('A') },
    slots: { inject: (_, fn) => fn(), register(options) { const entry = { options }; entries.add(entry); return () => entries.delete(entry) } },
    effect(fn) { disposers.push(fn()) } }
  const navigation = createWorkbenchNavigation(ctx, () => null)
  const project = (id, preset) => list.set({ byId: { ...list.getSnapshot().byId,
    [id]: { blank: true, projectionValues: { agentPreset: preset } } } })
  return { ctx, navigation, current, selection, project, entries, dispose: () => disposers.reverse().forEach(fn => fn()) }
}

test('an already loaded ScholarFlow session restores its workbench at boot', () => {
  const f = fixture()
  assert.equal(f.navigation.source.getSnapshot().active, true)
  f.dispose(); assert.equal(f.entries.size, 0)
})
test('a preset catalog update does not cancel an in-flight native new session', () => {
  const f = fixture('standard')
  const pending = f.ctx.layout.beginNavigation()
  f.project('A', 'scholarflow')
  assert.equal(pending.aborted, false)
  assert.equal(f.navigation.source.getSnapshot().active, true)
  f.dispose()
})
test('reopening the visible mode does not cancel an in-flight native navigation', () => {
  const f = fixture()
  const pending = f.ctx.layout.beginNavigation()
  f.navigation.open()
  assert.equal(pending.aborted, false)
  f.dispose()
})
test('opening the same blank ScholarFlow session restores its workbench', async () => {
  const f = fixture()
  f.navigation.open(); f.navigation.ordinary()
  f.selection.set({ sessionId: 'A' })
  await Promise.resolve()
  assert.equal(f.navigation.source.getSnapshot().active, true)
  f.dispose()
})
test('returning to ordinary chat survives a catalog refresh until explicit navigation', () => {
  const f = fixture()
  f.navigation.open(); f.navigation.ordinary()
  f.project('A', undefined); f.project('A', 'scholarflow')
  assert.equal(f.navigation.source.getSnapshot().active, false)
  f.navigation.open()
  assert.equal(f.navigation.source.getSnapshot().active, true)
  f.dispose()
})
test('ordinary conversations and global panels retain their native main surface', () => {
  const f = fixture('standard')
  assert.equal(f.entries.size, 0)
  f.current.set({ key: 'B' }); f.project('A', 'scholarflow')
  assert.equal(f.entries.size, 0)
  f.current.set({ key: 'A' })
  f.ctx.layout.selectPanel('settings')
  assert.equal(f.entries.size, 0)
  f.ctx.layout.selectPanel(null)
  assert.equal(f.navigation.source.getSnapshot().active, true)
  f.dispose()
})

test('a queued native selection cannot reinstall the surface after plugin disposal', async () => {
  const f = fixture()
  f.selection.set({ sessionId: 'A' })
  f.dispose()
  await Promise.resolve()
  assert.equal(f.entries.size, 0)
})
