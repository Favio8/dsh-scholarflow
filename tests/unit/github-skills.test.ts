import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { githubLocation, githubSkills } from '../../src/host/skills/github.ts'
import type { HostWeb } from '../../src/host/providers/crossref.ts'

const bytes = (text: string) => Buffer.from(text)
const blobSha = (content: Buffer) => createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex')
const instructions = bytes('---\nname: TEST_ONLY-github-static\ndescription: TEST_ONLY public repository fixture, never real retrieval\n---\nUse scripts/no-run.js.\n')
const script = bytes('throw new Error("TEST_ONLY must never run")\n')
const other = bytes('---\nname: TEST_ONLY-other\ndescription: TEST_ONLY do not download\n---\n')
const options = { capabilities: ['selection-transform' as const], suggestedStages: ['revision' as const] }
const signal = () => new AbortController().signal
function fixture() {
  const treeSha = 'b'.repeat(40), commitSha = 'a'.repeat(40), calls: URL[] = []
  const contents = new Map([instructions, script, other].map(content => [blobSha(content), content]))
  const entries = [
    { path: 'one', mode: '040000', type: 'tree', sha: 'c'.repeat(40) },
    { path: 'one/SKILL.md', mode: '100644', type: 'blob', sha: blobSha(instructions), size: instructions.length },
    { path: 'one/scripts', mode: '040000', type: 'tree', sha: 'd'.repeat(40) },
    { path: 'one/scripts/no-run.js', mode: '100755', type: 'blob', sha: blobSha(script), size: script.length },
    { path: 'two', mode: '040000', type: 'tree', sha: 'e'.repeat(40) },
    { path: 'two/SKILL.md', mode: '100644', type: 'blob', sha: blobSha(other), size: other.length },
  ]
  let intercept: ((url: URL, data: any) => any) | undefined
  const web: HostWeb = { async fetch(request, requestSignal) {
    requestSignal.throwIfAborted(); const url = new URL(request.url); calls.push(url)
    assert.equal(url.origin, 'https://api.github.com')
    let data: any
    if (url.pathname === '/repos/TEST-ONLY-owner/TEST_ONLY-repo') data = { default_branch: 'development', license: { spdx_id: 'TEST_ONLY', name: 'TEST_ONLY license' } }
    else if (url.pathname === '/repos/TEST-ONLY-owner/TEST_ONLY-repo/commits/development') data = { sha: commitSha, commit: { tree: { sha: treeSha } } }
    else if (url.pathname.endsWith(`/git/trees/${treeSha}`)) data = { sha: treeSha, tree: entries, truncated: false }
    else {
      const content = contents.get(url.pathname.split('/').at(-1)!)
      assert.ok(content, 'TEST_ONLY unexpected request')
      data = { sha: blobSha(content), size: content.length, encoding: 'base64', content: content.toString('base64') }
    }
    return { url: url.toString(), statusCode: 200, truncated: false, body: { kind: 'text', content: JSON.stringify(intercept?.(url, data) ?? data) } }
  } }
  return { provider: githubSkills(web), calls, entries, commitSha, setIntercept(value: typeof intercept) { intercept = value } }
}

test('SF-020: GitHub URL parsing requires explicit slash-containing refs and never guesses the default branch', () => {
  assert.deepEqual(githubLocation('https://github.com/TEST-ONLY-owner/TEST_ONLY-repo'), {
    owner: 'TEST-ONLY-owner', repo: 'TEST_ONLY-repo', repository: 'https://github.com/TEST-ONLY-owner/TEST_ONLY-repo', ref: undefined, subpath: '' })
  assert.throws(() => githubLocation('https://github.com/TEST-ONLY-owner/TEST_ONLY-repo/tree/feature/slash/skills/one'), { code: 'SKILL_REF_REQUIRED' })
  assert.equal(githubLocation('https://github.com/TEST-ONLY-owner/TEST_ONLY-repo/tree/feature/slash/skills/one', 'feature/slash').subpath, 'skills/one')
  assert.equal(githubLocation('https://github.com/TEST-ONLY-owner/TEST_ONLY-repo/blob/feature/slash/skills/one/SKILL.md', 'feature/slash').subpath, 'skills/one')
  for (const url of ['http://github.com/x/y', 'https://github.com.evil.test/x/y', 'https://key@github.com/x/y', 'https://github.com/x/y?token=TEST_ONLY', 'https://github.com/x/y/blob/main/README.md'])
    assert.throws(() => githubLocation(url, 'main'))
})

test('SF-020/021: multi-Skill discovery fixes the server default branch to a commit and downloads only the confirmed static tree', async () => {
  const f = fixture(), discovery = await f.provider.discover(githubLocation('https://github.com/TEST-ONLY-owner/TEST_ONLY-repo'), signal())
  assert.equal(discovery.ref, 'development'); assert.equal(discovery.commit, f.commitSha)
  assert.deepEqual(discovery.candidates, ['one', 'two'])
  assert.equal(f.calls.some(url => url.pathname.includes('/git/blobs/')), false, 'discovery reads no resource blobs')
  const preview = await f.provider.preview(discovery, 'one', options, signal())
  assert.equal(f.calls.filter(url => url.pathname.includes('/git/blobs/')).length, 1, 'only SKILL.md is needed for the preview')
  assert.equal(preview.metadata.compatibility, 'partial')
  const bundle = await f.provider.download(preview, signal())
  assert.equal(bundle.manifest.origin.kind, 'github')
  assert.equal((bundle.manifest.origin as any).commit, f.commitSha)
  assert.deepEqual(bundle.files.map(file => file.relativePath), ['SKILL.md', 'scripts/no-run.js'])
  assert.equal(Buffer.from(bundle.files[1].bytes).toString(), script.toString())
  assert.equal(f.calls.some(url => url.pathname.endsWith(blobSha(other))), false, 'another Skill never enters the download')
  assert.equal(f.calls.filter(url => url.pathname.includes('/commits/')).length, 1, 'branch movement is not re-resolved on install')
})

test('GitHub links, submodules, incomplete trees and modified blobs fail before installation', async () => {
  for (const mode of ['120000', '160000']) {
    const f = fixture()
    f.entries.push({ path: 'one/linked', mode, type: mode === '120000' ? 'blob' : 'commit', sha: 'f'.repeat(40), size: 10 } as any)
    const discovery = await f.provider.discover(githubLocation('https://github.com/TEST-ONLY-owner/TEST_ONLY-repo'), signal())
    await assert.rejects(f.provider.preview(discovery, 'one', options, signal()), { code: 'SKILL_SOURCE_LINK' })
    assert.equal(f.calls.some(url => url.pathname.includes('/git/blobs/')), false)
  }
  const truncated = fixture(); truncated.setIntercept((url, data) => url.pathname.includes('/trees/') ? { ...data, truncated: true } : data)
  await assert.rejects(truncated.provider.discover(githubLocation('https://github.com/TEST-ONLY-owner/TEST_ONLY-repo'), signal()), { code: 'SKILL_GITHUB_TREE_INVALID' })
  const altered = fixture(), discovery = await altered.provider.discover(githubLocation('https://github.com/TEST-ONLY-owner/TEST_ONLY-repo'), signal())
  altered.setIntercept((url, data) => url.pathname.includes('/blobs/') ? { ...data, content: bytes('TEST_ONLY changed bytes').toString('base64') } : data)
  await assert.rejects(altered.provider.preview(discovery, 'one', options, signal()), { code: 'SKILL_GITHUB_BLOB_INVALID' })
})

test('GitHub access denial has no hidden retry and cancellation reaches the Host network seam', async () => {
  for (const statusCode of [403, 429]) {
    let calls = 0
    const provider = githubSkills({ async fetch({ url }) { calls++; return { url, statusCode, truncated: false, body: { kind: 'text', content: '{}' } } } })
    await assert.rejects(provider.discover(githubLocation('https://github.com/TEST-ONLY-owner/TEST_ONLY-repo'), signal()), { code: 'SKILL_GITHUB_RATE_LIMITED' })
    assert.equal(calls, 1)
  }
  const f = fixture(), controller = new AbortController(); controller.abort()
  await assert.rejects(f.provider.discover(githubLocation('https://github.com/TEST-ONLY-owner/TEST_ONLY-repo'), controller.signal), { name: 'AbortError' })
  assert.equal(f.calls.length, 0)
})
