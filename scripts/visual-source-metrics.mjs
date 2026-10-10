// SF-133 baseline counters. Counts are declaration text, not unique computed lengths.
// These expose existing debt before SF-121/122/126/128; later steps enforce their thresholds.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function visualSourceMetrics(directory) {
  const files = []
  const walk = path => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (/\.tsx?$/.test(entry.name)) files.push(file)
    }
  }
  walk(directory)
  const fontTokens = new Set(), padding = new Set(), literalFontSizes = [], primaryDefinitions = []
  let importantOccurrences = 0, selectElements = 0
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    importantOccurrences += (text.match(/!important\b/g) ?? []).length
    selectElements += (text.match(/<select\b/g) ?? []).length
    for (const match of text.matchAll(/\bfont-size\s*:\s*([^;}\n]+)/g)) {
      for (const token of match[1].matchAll(/var\((--sf-font-[\w-]+)/g)) fontTokens.add(token[1])
      if (/\b\d+(?:\.\d+)?(?:px|pt|rem|em)\b/.test(match[1])) literalFontSizes.push({ file, declaration: match[0] })
    }
    for (const match of text.matchAll(/\bfontSize\s*:\s*(\d+(?:\.\d+)?)/g)) literalFontSizes.push({ file, declaration: match[0] })
    for (const match of text.matchAll(/(?:^|[;{])\s*padding\s*:\s*([^;}\n]+)/g)) padding.add(match[1].trim())
    for (const match of text.matchAll(/([^{}]+)\{/g)) {
      const selectors = match[1].trim()
      // Count rule definitions (including grouped selectors), never JSX references.
      if (selectors.split(',').some(selector => /\.sf-primary\s*$/.test(selector))) primaryDefinitions.push({ file, selectors })
    }
  }
  return {
    scope: 'src/client', mode: 'baseline-observation',
    fontSizeLiterals: literalFontSizes, fontTokenKinds: [...fontTokens].sort(),
    paddingDeclarationKinds: [...padding].sort(),
    primaryDefinitions, selectElements, importantOccurrences,
    thresholds: { fontSizeLiterals: 0, fontTokenKinds: 7, paddingDeclarationKinds: 20, primaryDefinitions: 1, importantOccurrences: 54 },
  }
}
