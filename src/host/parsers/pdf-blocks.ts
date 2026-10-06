/**
 * Splits one page of extracted text into citable blocks.
 *
 * A table row is recognised by carrying several numeric cells, and is kept on its own so the
 * numbers stay in one place and can be quoted. Everything else accumulates into a paragraph,
 * broken at a blank line, at a heading-looking line, or when it grows past the excerpt limit —
 * a block longer than that would be truncated when it is stored as evidence.
 */
export function splitPageIntoBlocks(text: string, maxChars = 1500) {
  const lines = text.split('\n').map(line => line.replace(/\s+$/, '')).filter(line => line.trim())
  const numericCells = (line: string) => (line.match(/(?<![\w.])\d+(?:\.\d+)?(?![\w])/g) ?? []).length
  const isTableRow = (line: string) => numericCells(line) >= 2 && line.split(/\s{2,}|\t|\s(?=\d)/).filter(part => part.trim()).length >= 3
  const isHeading = (line: string) => /^\d+(\.\d+)*\.?\s+\S/.test(line.trim()) && line.trim().length < 90
  const blocks: { text: string; kind: 'paragraph' | 'table' | 'heading' }[] = []
  let current: string[] = []
  const flush = () => { const joined = current.join('\n').trim(); if (joined) blocks.push({ text: joined, kind: 'paragraph' }); current = [] }
  for (const line of lines) {
    if (isTableRow(line)) { flush(); blocks.push({ text: line.trim(), kind: 'table' }); continue }
    if (isHeading(line) && current.length) flush()
    current.push(line)
    if (current.join('\n').length >= maxChars) flush()
  }
  flush()
  // A page that yields one giant line still has to be cut, or its evidence would be truncated.
  return blocks.flatMap(block => block.text.length <= maxChars * 2 ? [block]
    : block.text.match(new RegExp(`[\\s\\S]{1,${maxChars}}`, 'g'))!.map(text => ({ text, kind: block.kind })))
}
