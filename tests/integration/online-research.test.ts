import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { prepareInit, initialize, snapshot } from '../../src/core/project/project.ts'
import { prepareSearch, executeSearch, readSearch, decideCandidate, applyIdentityLookup, prepareLookup, executeLookup } from '../../src/core/research/online.ts'
import { candidateSchema, type ResearchProvider } from '../../src/shared/online-research.ts'
import { digest, json } from '../../src/core/store/files.ts'

const candidate = candidateSchema.parse({ candidateId: 'candidate_TEST_ONLY', provider: 'crossref', recordId: '10.5555/test_only',
  sourceUrl: 'https://api.crossref.org/works/10.5555%2Ftest_only', retrievedAt: '2026-10-05T01:00:00.000Z', title: 'TEST_ONLY provider fixture',
  authors: [{ literal: 'TEST_ONLY Author' }], year: 2024, identifiers: { doi: '10.5555/test_only', url: 'https://doi.org/10.5555/test_only' }, kind: 'paper', textAccess: 'metadata', warnings: [] })
const fixtureProvider: ResearchProvider = { id: 'crossref', capabilities: { search: true, lookupIdentifier: true, fullText: false },
  async search() { return { records: [candidate], warnings: ['TEST_ONLY metadata, no full text'] } }, async lookup() { return candidate } }
const search = { query: 'TEST_ONLY query', purpose: 'TEST_ONLY research question', limit: 3 }
async function project() {
  const io = new MemoryStore({ '原始资料.txt': 'TEST_ONLY raw bytes' })
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY research project', type: 'literature-review' }))
  return io
}

test('SF-009: search candidates are durable metadata and require a reasoned inclusion before becoming sources', async () => {
  const io = await project(), before = await snapshot(io), plan = await prepareSearch(io, search)
  assert.equal(await io.stat(`.scholarflow/research/${plan.id}.json`), undefined, 'preview alone does not write')
  const result = await executeSearch(io, plan, fixtureProvider, new AbortController().signal)
  assert.equal(result.state, 'completed')
  assert.deepEqual((await snapshot(io)).ledger.sources, {})
  assert.equal((await readSearch(io, plan.id)).record.records[0].textAccess, 'metadata')
  await assert.rejects(() => decideCandidate(io, plan.id, candidate.candidateId, 'include', '', 0), { code: 'INVALID_REQUEST' })
  const included = await decideCandidate(io, plan.id, candidate.candidateId, 'include', 'TEST_ONLY selected for fixture verification', 0)
  assert.equal(included.source?.identity.status, 'unverified')
  assert.equal(included.source?.textAccess, 'metadata')
  assert.equal((await snapshot(io)).document.contentHash, before.document.contentHash)
  assert.equal((await io.read('原始资料.txt'))?.text, 'TEST_ONLY raw bytes')
  await assert.rejects(() => executeSearch(io, plan, fixtureProvider, new AbortController().signal), { code: 'STALE_LEDGER_REVISION' })
})

test('SF-010: DOI lookup preserves metadata and stable citation keys, and keeps identity separate from semantic support', async () => {
  const io = await project(), plan = await prepareSearch(io, search)
  await executeSearch(io, plan, fixtureProvider, new AbortController().signal)
  const included = await decideCandidate(io, plan.id, candidate.candidateId, 'include', 'TEST_ONLY reason', 0), source = included.source!
  const matched = await applyIdentityLookup(io, source.id, digest(json(source)), candidate, included.revision)
  const current = matched.ledger.sources[source.id]
  assert.equal(current.identity.status, 'matched')
  assert.equal(current.citeKey, source.citeKey)
  assert.equal(current.textAccess, 'metadata')
  assert.deepEqual(matched.ledger.evidence, {})
  const mismatch = await applyIdentityLookup(io, source.id, digest(json(current)), { ...candidate, title: 'TEST_ONLY different title' }, matched.revision)
  assert.equal(mismatch.ledger.sources[source.id].identity.status, 'mismatch')
  assert.equal(mismatch.ledger.sources[source.id].title, source.title)
  assert.equal(mismatch.ledger.sources[source.id].citeKey, source.citeKey)
})

test('failed searches retain an explicit failure snapshot without adding sources or automatically retrying', async () => {
  const io = await project(), plan = await prepareSearch(io, search)
  let calls = 0
  const failure = await executeSearch(io, plan, { ...fixtureProvider, async search() { calls++; throw new Error('TEST_ONLY provider failure') } }, new AbortController().signal)
  assert.equal(failure.state, 'failed')
  assert.equal(calls, 1)
  assert.equal((await readSearch(io, plan.id)).record.state, 'failed')
  assert.deepEqual((await snapshot(io)).ledger.sources, {})
})

test('duplicate DOI inclusion reuses the existing source while preserving user annotations and evidence', async () => {
  const io = await project(), first = await prepareSearch(io, search)
  await executeSearch(io, first, fixtureProvider, new AbortController().signal)
  const included = await decideCandidate(io, first.id, candidate.candidateId, 'include', 'TEST_ONLY first reason', 0)
  const second = await prepareSearch(io, search)
  await executeSearch(io, second, fixtureProvider, new AbortController().signal)
  const duplicate = await decideCandidate(io, second.id, candidate.candidateId, 'include', 'TEST_ONLY follow-up verification', included.revision)
  assert.deepEqual(duplicate.source, included.source)
  assert.equal(Object.keys((await snapshot(io)).ledger.sources).length, 1)
})

test('DOI requests checkpoint their budget before provider IO and release the project writer lock', async () => {
  const io = await project(), searchPlan = await prepareSearch(io, search)
  await executeSearch(io, searchPlan, fixtureProvider, new AbortController().signal)
  const included = await decideCandidate(io, searchPlan.id, candidate.candidateId, 'include', 'TEST_ONLY reason', 0)
  const plan = await prepareLookup(io, included.source!.id)
  const result = await executeLookup(io, plan, { ...fixtureProvider, async lookup() {
    const checkpoint = JSON.parse((await io.read(`.scholarflow/research/${plan.id}.json`))!.text)
    assert.equal(checkpoint.state, 'running')
    assert.equal(checkpoint.queriesUsed, 1)
    assert.equal(await io.lock(async () => true), true)
    return candidate
  } }, new AbortController().signal)
  assert.ok('source' in result)
  assert.equal(result.source.identity.status, 'matched')
  const checkpoint = JSON.parse((await io.read(`.scholarflow/research/${plan.id}.json`))!.text)
  assert.equal(checkpoint.state, 'completed')
  assert.equal(checkpoint.identity.status, 'matched')
  assert.equal(checkpoint.found.textAccess, 'metadata')
})

test('a provider result cannot overwrite source edits made during IO; its conflict snapshot remains available', async () => {
  const io = await project(), searchPlan = await prepareSearch(io, search)
  await executeSearch(io, searchPlan, fixtureProvider, new AbortController().signal)
  const included = await decideCandidate(io, searchPlan.id, candidate.candidateId, 'include', 'TEST_ONLY reason', 0)
  const plan = await prepareLookup(io, included.source!.id)
  const result = await executeLookup(io, plan, { ...fixtureProvider, async lookup() {
    const ledger = (await snapshot(io)).ledger
    ledger.sources[plan.sourceId].title = 'TEST_ONLY externally revised title'; ledger.revision++
    io.externalEdit('.scholarflow/data/ledger.json', json(ledger))
    return candidate
  } }, new AbortController().signal)
  assert.ok('errorCode' in result)
  assert.equal(result.errorCode, 'STALE_LEDGER_REVISION')
  assert.equal((await snapshot(io)).ledger.sources[plan.sourceId].title, 'TEST_ONLY externally revised title')
  const checkpoint = JSON.parse((await io.read(`.scholarflow/research/${plan.id}.json`))!.text)
  assert.equal(checkpoint.state, 'conflict')
  assert.equal(checkpoint.found.title, candidate.title)
})

test('cancelled research requests retain their used-query checkpoint and preserve sources and manuscript', async () => {
  const io = await project(), first = await prepareSearch(io, search)
  await executeSearch(io, first, fixtureProvider, new AbortController().signal)
  const included = await decideCandidate(io, first.id, candidate.candidateId, 'include', 'TEST_ONLY reason', 0)
  const before = await snapshot(io), lookup = await prepareLookup(io, included.source!.id), lookupControl = new AbortController()
  const cancelled = await executeLookup(io, lookup, { ...fixtureProvider, async lookup() { lookupControl.abort(); return candidate } }, lookupControl.signal)
  assert.ok('errorCode' in cancelled)
  assert.equal(cancelled.errorCode, 'RESEARCH_CANCELLED')
  assert.deepEqual((await snapshot(io)).ledger.sources, before.ledger.sources)
  assert.equal(JSON.parse((await io.read(`.scholarflow/research/${lookup.id}.json`))!.text).state, 'cancelled')
  const plan = await prepareSearch(io, search), searchControl = new AbortController()
  const result = await executeSearch(io, plan, { ...fixtureProvider, async search() { searchControl.abort(); return { records: [candidate], warnings: [] } } }, searchControl.signal)
  assert.equal(result.state, 'cancelled')
  assert.equal(result.queriesUsed, 1)
  assert.deepEqual((await snapshot(io)).ledger.sources, before.ledger.sources)
  assert.equal((await snapshot(io)).document.contentHash, before.document.contentHash)
})
