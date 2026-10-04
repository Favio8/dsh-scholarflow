import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crossrefProvider } from '../../src/host/providers/crossref.ts'

const fixture = { DOI: '10.5555/TEST_ONLY', title: ['TEST_ONLY provider metadata'], author: [{ family: 'TEST_ONLY', given: 'Fixture' }],
  issued: { 'date-parts': [[2024, 1, 2]] }, 'container-title': ['TEST_ONLY journal'], type: 'journal-article', abstract: 'TEST_ONLY not ingested' }
const response = (message: unknown, statusCode = 200, truncated = false) => ({ url: 'https://api.crossref.org/works', statusCode,
  truncated, body: { kind: 'text', content: JSON.stringify({ status: 'ok', message }) } })

test('Crossref sends only approved query parameters and maps actual metadata without claiming full text', async () => {
  let requested = ''
  const provider = crossrefProvider({ async fetch({ url }) { requested = url; return response({ items: [fixture, fixture, { DOI: 'invalid' }] }) } })
  const result = await provider.search({ query: 'TEST_ONLY research query', purpose: 'TEST_ONLY local research rationale', limit: 3, yearFrom: 2020, yearTo: 2025 }, new AbortController().signal)
  const url = new URL(requested)
  assert.equal(url.origin, 'https://api.crossref.org')
  assert.equal(url.searchParams.get('query.bibliographic'), 'TEST_ONLY research query')
  assert.equal(url.searchParams.has('purpose'), false)
  assert.equal(url.searchParams.get('filter'), 'from-pub-date:2020-01-01,until-pub-date:2025-12-31')
  assert.equal(result.records.length, 1)
  assert.equal(result.records[0].textAccess, 'metadata')
  assert.equal(result.records[0].recordId, '10.5555/test_only')
  assert.equal('abstract' in result.records[0], false)
  assert.equal(provider.capabilities.fullText, false)
  assert.match(result.warnings.join(' '), /未通过元数据校验/u)
})

test('identifier lookup normalizes DOI and refuses mismatching records, hostile redirects and incomplete bodies', async () => {
  let requested = ''
  const provider = crossrefProvider({ async fetch({ url }) { requested = url; return response(fixture) } })
  const found = await provider.lookup('https://doi.org/10.5555/TEST_ONLY', new AbortController().signal)
  assert.equal(found?.recordId, '10.5555/test_only')
  assert.equal(new URL(requested).pathname, '/works/10.5555%2Ftest_only')
  await assert.rejects(() => provider.lookup('10.5555/OTHER_TEST_ONLY', new AbortController().signal), { code: 'RESEARCH_IDENTIFIER_MISMATCH' })
  for (const result of [{ ...response(fixture), url: 'http://127.0.0.1/private' }, response(fixture, 200, true), response({ invalid: true })]) {
    const bad = crossrefProvider({ async fetch() { return result } })
    await assert.rejects(() => bad.lookup('10.5555/test_only', new AbortController().signal))
  }
})

test('Crossref stops on missing records, access denial and rate limiting without hidden retries', async () => {
  for (const status of [404, 401, 403, 429, 503]) {
    let calls = 0
    const provider = crossrefProvider({ async fetch() { calls++; return response(null, status) } })
    if (status === 404) assert.equal(await provider.lookup('10.5555/test_only', new AbortController().signal), null)
    else await assert.rejects(() => provider.lookup('10.5555/test_only', new AbortController().signal))
    assert.equal(calls, 1)
  }
})

test('Crossref enforces one in-flight request and forwards cancellation through the Host', async () => {
  let finish!: (value: ReturnType<typeof response>) => void, received: AbortSignal | undefined
  const provider = crossrefProvider({ fetch(_request, signal) { received = signal; return new Promise(resolve => { finish = resolve }) } })
  const controller = new AbortController(), first = provider.lookup('10.5555/test_only', controller.signal)
  assert.equal(received, controller.signal)
  await assert.rejects(() => provider.lookup('10.5555/test_only', controller.signal), { code: 'RESEARCH_PROVIDER_BUSY' })
  finish(response(fixture)); await first
  const cancelled = provider.lookup('10.5555/test_only', controller.signal)
  const rejected = assert.rejects(() => cancelled, { name: 'AbortError' })
  controller.abort(); finish(response(fixture)); await rejected
})
