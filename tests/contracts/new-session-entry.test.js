import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { parseHTML } from 'linkedom'

const bundle = await build({ entryPoints: ['src/client/new-session-entry.tsx'], bundle: true, write: false,
  platform: 'node', format: 'esm', packages: 'external' })
const code = bundle.outputFiles[0].text.replace('from "react"', `from ${JSON.stringify(import.meta.resolve('react'))}`)
const { nativeNewSessionButton, createNativeSession } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

function fixture() {
  const navigation = new AbortController(), requests = [], opened = []
  const old = { blank: true, updatedAt: 100, projectionValues: { agentPreset: 'scholarflow' } }
  const ctx = { layout: { beginNavigation: () => navigation.signal },
    uiSession: { adapter: { current: { getSnapshot: () => ({ key: 'SF' }) } } },
    uiWorkspace: { openSession: async id => opened.push(id) },
    workspaces: { list: { getSnapshot: () => ({ items: [
      { workspaceId: 'A', sessionIds: ['SF'], createdAt: '2026-10-01' },
      { workspaceId: 'B', sessionIds: [], createdAt: '2026-10-02' },
    ] }) } },
    sessions: { list: { getSnapshot: () => ({ byId: { SF: old } }) }, refresh: async () => {} },
    connection: { rpc: { call: async (namespace, method, payload) => { requests.push({ namespace, method, payload }); return { ok: true, value: { sessionId: 'NEW' } } } } },
  }
  return { ctx, navigation, requests, opened, old }
}

test('native new-button recognition excludes history, mode controls and workspace menus', () => {
  const { document } = parseHTML('<html><body><div data-row-key="workspace:B"><button aria-label="在“科技论文写作”中新建会话"></button><button aria-label="工作区菜单"></button></div><button aria-label="New session"></button><button aria-label="ScholarFlow"></button><div data-row-key="session:SF"><button aria-label="打开会话"></button></div></body></html>')
  const buttons = [...document.querySelectorAll('button')]
  assert.deepEqual(nativeNewSessionButton(buttons[0]), { workspaceId: 'B' })
  assert.equal(nativeNewSessionButton(buttons[1]), undefined)
  assert.deepEqual(nativeNewSessionButton(buttons[2]), {})
  assert.equal(nativeNewSessionButton(buttons[3]), undefined)
  assert.equal(nativeNewSessionButton(buttons[4]), undefined)
})

test('global new delegates the preset to the Host default without reusing or modifying ScholarFlow', async () => {
  const f = fixture()
  await createNativeSession(f.ctx)
  assert.deepEqual(f.requests[0], { namespace: '/api', method: 'session/create', payload: { args: { request: { workspaceId: 'A' } } } })
  assert.deepEqual(f.opened, ['NEW'])
  assert.equal(f.old.projectionValues.agentPreset, 'scholarflow')
})

test('workspace new uses the clicked workspace, and a late result cannot replace newer navigation', async () => {
  const f = fixture()
  f.ctx.sessions.refresh = async () => { f.navigation.abort() }
  await createNativeSession(f.ctx, 'B')
  assert.equal(f.requests[0].payload.args.request.workspaceId, 'B')
  assert.deepEqual(f.opened, [])
})

test('a Host refusal is reported without navigating or changing an existing session', async () => {
  const f = fixture()
  f.ctx.connection.rpc.call = async () => ({ ok: false, error: { message: 'TEST_ONLY refusal' } })
  await assert.rejects(createNativeSession(f.ctx), /TEST_ONLY refusal/)
  assert.deepEqual(f.opened, [])
  assert.equal(f.old.projectionValues.agentPreset, 'scholarflow')
})
