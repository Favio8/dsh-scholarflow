import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const output = resolve('.dsh-tmp/contracts/creation-draft.mjs')
await build({ entryPoints: ['src/client/creation-wizard.tsx'], bundle: true, outfile: output,
  platform: 'node', format: 'esm', packages: 'external', define: { __SF_KATEX_CSS__: '""' } })
const { CreationWizard, restoreCreationDraft } = await import(pathToFileURL(output).href)

// Matches the stored pre-upgrade drafts observed in the user's actual Desktop.
const legacy = { title: '', type: 'course-paper', language: 'zh-CN', format: 'docx', requirements: '',
  materials: ['课件/第3讲.pdf'], online: false, targetLength: 4000, manuscriptDir: 'manuscript',
  sections: [{ id: 'section_1', title: '引言', purpose: '', targetLength: 900 }] }

test('all three wizard steps render from a pre-upgrade local draft without discarding input', () => {
  const previous = globalThis.localStorage
  try {
    for (const step of [0, 1, 2]) {
      globalThis.localStorage = { getItem: () => JSON.stringify({ spec: legacy, step }) }
      const html = renderToStaticMarkup(React.createElement(CreationWizard, { scope: 'TEST_ONLY',
        api: async () => ({}), context: () => ({}), workspaceTitle: 'TEST_ONLY', onCreated() {} }))
      assert.match(html, /sf-wizard/)
      assert.match(html, /sf-wizard-page/)
    }
    const restored = restoreCreationDraft(legacy)
    assert.equal(restored.title, '', 'unfinished input remains valid as a draft')
    assert.equal(restored.requirements, '')
    assert.deepEqual(restored.materials, legacy.materials)
    assert.deepEqual(restored.requirementSources, [])
    assert.equal(restored.countingPolicy.scope, 'body')
    assert.equal(restored.sections[0].targetLength, 900)
    assert.equal(restored.sections[0].allocationMode, 'manual', 'legacy lengths must not be redistributed')
    assert.equal('requirementSources' in legacy, false, 'restoration does not mutate its input')
  } finally { if (previous === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous }
})

test('legacy assignment selection is retained and modern sources and allocation keep precedence', () => {
  const restored = restoreCreationDraft({ ...legacy, assignmentPath: '要求/作业说明.md' })
  assert.equal(restored.requirementSources[0].path, '要求/作业说明.md')
  assert.equal(restored.assignmentPath, undefined, 'removing the migrated source must not leave a hidden legacy read selection')
  const modern = { ...restored, requirementSources: [], countingPolicy: { unit: 'en', scope: 'body', includeAbstract: true, algorithmVersion: 1 },
    sections: [{ ...restored.sections[0], allocationMode: 'auto', allocationWeight: 2 }] }
  assert.deepEqual(restoreCreationDraft(modern), modern)
  assert.deepEqual(restoreCreationDraft(restored), restored, 'restoration is idempotent')
})
