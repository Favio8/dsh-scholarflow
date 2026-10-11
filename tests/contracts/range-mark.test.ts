// TEST_ONLY: renders the real markdown view in Node and asserts the inline mark of a rewrite
// range. No host, no model, no browser: the component is bundled the same way the client is and
// rendered to static markup, so the assertion is about the shipped renderer rather than a copy.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { projectMarkdown } from '../../src/core/editing/markdown.ts'

const output = resolve('.dsh-tmp/contracts/markdown-view.mjs')
await mkdir(dirname(output), { recursive: true })
await build({ entryPoints: [resolve('src/client/markdown.tsx')], bundle: true, outfile: output,
  platform: 'node', format: 'esm', packages: 'external' })
const { MarkdownView, markedSlice } = await import(pathToFileURL(output).href) as {
  MarkdownView: (props: { projection: unknown; markRange?: { start: number; end: number; flowing: boolean } }) => React.ReactElement
  markedSlice: (leaf: unknown, range: { start: number; end: number }) => { start: number; end: number } | undefined
}

const render = (source: string, range: { start: number; end: number }, flowing = false) =>
  renderToStaticMarkup(React.createElement(MarkdownView, { projection: projectMarkdown(source), markRange: { ...range, flowing } }))
const marks = (html: string) => [...html.matchAll(/<span class="sf-mark-inline" data-sf-marked="true"[^>]*>([\s\S]*?)<\/span>/g)].map(match => match[1])
const rangeOf = (source: string, text: string) => ({ start: source.indexOf(text), end: source.indexOf(text) + text.length })

test('SF-163: selecting and generating keep the text DOM unchanged', () => {
  const source = '# 标题\n\n第一句。**第二句**。\n',range=rangeOf(source,'第二句')
  const ordinary=renderToStaticMarkup(React.createElement(MarkdownView,{projection:projectMarkdown(source)}))
  assert.equal(render(source,range),ordinary)
  assert.equal(render(source,range,true),ordinary)
  assert.deepEqual(marks(ordinary),[])
})

test('a range that covers nothing marked renders no mark at all', () => {
  const source = '# 标题\n\n第一句。\n'
  assert.deepEqual(marks(render(source, { start: 0, end: 1 })), [])
  assert.deepEqual(marks(render(source, { start: 5, end: 5 })), [])
})

test('protected content is never wrapped: formulas and inline code keep rendering as themselves', () => {
  const source = '# 标题\n\n前 $x^2$ 中 `code` 后\n'
  const html = render(source, { start: source.indexOf('前'), end: source.indexOf('后') + 1 })
  assert.deepEqual(marks(html), [])
  for (const inner of marks(html)) assert.equal(inner.includes('<'), false, 'a marked span carries text only')
  assert.ok(html.includes('katex'), 'the formula still renders as a formula')
  assert.ok(html.includes('<code data-sf-protected="true">code</code>'), 'the inline code still renders as code')
})

test('SF-163: candidate motion does not recolour or split the source glyphs', () => {
  const source='# 标题\n\n一句。\n'
  const html=render(source,rangeOf(source,'一句'),true)
  assert.equal(marks(html).length,0)
  assert.equal(html.includes('data-flow'),false)
})

test('a decoded entity is marked as a whole unit rather than by a character guess', () => {
  // `a&amp;b` renders as three characters but spans seven source offsets.
  const leaf = { id: 'leaf_TEST_ONLY', text: 'a&b', start: 0, end: 7, mappable: true, units: [
    { renderedStart: 0, renderedEnd: 1, sourceStart: 0, sourceEnd: 1 },
    { renderedStart: 1, renderedEnd: 2, sourceStart: 1, sourceEnd: 6 },
    { renderedStart: 2, renderedEnd: 3, sourceStart: 6, sourceEnd: 7 }] }
  assert.deepEqual(markedSlice(leaf, { start: 1, end: 6 }), { start: 1, end: 2 })
  // A range that only clips the entity still marks the whole entity, never half of it.
  assert.deepEqual(markedSlice(leaf, { start: 3, end: 4 }), { start: 1, end: 2 })
  assert.equal(markedSlice(leaf, { start: 0, end: 0 }), undefined)
  assert.equal(markedSlice({ ...leaf, mappable: false }, { start: 0, end: 7 }), undefined)
})

test('SF-163: selection and rewrite backgrounds use theme tokens and leave glyphs opaque', () => {
  const source=readFileSync(resolve('src/client/range-mark.tsx'),'utf8')
  const from=source.indexOf('export const RANGE_MARK_CSS = `')+'export const RANGE_MARK_CSS = `'.length
  const css=source.slice(from,source.indexOf('`',from))
  assert.equal(/#[0-9a-fA-F]{3,8}/.test(css),false)
  assert.match(css,/::highlight\(sf-rewrite\)/)
  assert.match(css,/background:var\(--sf-selection-bg\);color:var\(--sf-selection-text\)/)
  assert.equal(css.includes('color:transparent'),false)
})
