import { test } from 'node:test'
import assert from 'node:assert/strict'
import { packageSkill, verifySkill } from '../../src/core/skills/package.ts'
import { digest } from '../../src/core/store/files.ts'
import type { SkillFile } from '../../src/shared/skills.ts'

const bytes = (text: string) => new TextEncoder().encode(text)
const original = '\uFEFF---\r\nname: test-only-skill\r\ndescription: TEST_ONLY static instruction fixture\r\nallowed-tools: Bash(python:*)\r\n---\r\n\r\nTEST_ONLY Run scripts/example.py; never used as real instructions.\r\n'
const files = (): SkillFile[] => [{ relativePath: 'SKILL.md', bytes: bytes(original) },
  { relativePath: 'scripts/example.py', bytes: bytes('raise RuntimeError("TEST_ONLY must never execute")\n') },
  { relativePath: 'references/例子.md', bytes: bytes('TEST_ONLY reference') }]
const origin = { kind: 'local' as const, rootFingerprint: digest('TEST_ONLY source root'), subpath: 'test-only-skill' }
const options = { capabilities: ['selection-transform' as const], suggestedStages: ['revision' as const] }

test('SF-020/026: packaging preserves original instructions and treats bundled scripts and tool declarations as inert data', () => {
  const input = files(), bundle = packageSkill('local:TEST_ONLY', input, origin, options)
  assert.equal(bundle.instructions, original)
  assert.equal(bundle.manifest.metadata.executionPolicy, 'instructions-only')
  assert.equal(bundle.manifest.metadata.compatibility, 'partial')
  assert.match(bundle.manifest.metadata.warnings.join(' '), /不执行/u)
  assert.equal(verifySkill(bundle), bundle)
  input[0].bytes.fill(0)
  assert.equal(bundle.instructions, original)
  assert.equal(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bundle.files.find(file => file.relativePath === 'SKILL.md')!.bytes), original)
})

test('SF-021: a pinned digest covers complete resource bytes and routing metadata independent of discovery order', () => {
  const first = packageSkill('local:TEST_ONLY', files(), origin, options)
  const second = packageSkill('local:TEST_ONLY', files().reverse(), origin, options)
  assert.equal(first.manifest.digest, second.manifest.digest)
  const changed = files(); changed[2].bytes = bytes('TEST_ONLY changed reference')
  assert.notEqual(packageSkill('local:TEST_ONLY', changed, origin, options).manifest.digest, first.manifest.digest)
  assert.notEqual(packageSkill('local:TEST_ONLY', files(), origin, { capabilities: ['draft-section'], suggestedStages: ['drafting'] }).manifest.digest, first.manifest.digest)
  first.files[0].bytes.fill(1)
  assert.throws(() => verifySkill(first), { code: 'SKILL_DIGEST_MISMATCH' })
})

test('invalid skill trees cannot smuggle traversal, case aliases, credentials or dependency directories into the library', () => {
  for (const path of ['../SKILL.md', 'C:/private', 'references/.credentials.yaml', 'node_modules/package/index.js', 'skill.md']) {
    assert.throws(() => packageSkill('local:TEST_ONLY', [...files(), { relativePath: path, bytes: bytes('TEST_ONLY excluded file') }], origin, options))
  }
  assert.throws(() => packageSkill('local:TEST_ONLY', [{ relativePath: 'README.md', bytes: bytes('TEST_ONLY README is not a Skill') }], origin, options), { code: 'SKILL_ENTRY_MISSING' })
  assert.throws(() => packageSkill('local:TEST_ONLY', [{ relativePath: 'SKILL.md', bytes: bytes('---\nname: a\nname: b\ndescription: TEST_ONLY\n---\n') }], origin, options), { code: 'SKILL_FRONTMATTER_INVALID' })
})
