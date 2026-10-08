export type TextRange = { start: number; end: number }

/**
 * The pane holds LF while the manuscript may hold CRLF, so an offset in one is not an offset in the
 * other. These two directions are the only place that conversion happens, because getting one of
 * them wrong shifts a selection silently; `tests/unit/rewrite-range.test.ts` pins them as a pair.
 */
export function sourceOffset(value: string, index: number, lineEnding: string) {
  const prefix = value.slice(0, index)
  return lineEnding === 'crlf' ? prefix.replace(/\n/g, '\r\n').length : prefix.length
}

/** The inverse: a manuscript offset as an offset into the pane's own text. */
export function paneOffset(value: string, index: number) {
  return value.slice(0, index).replace(/\r\n|\r/g, '\n').length
}

/**
 * The range a rewrite currently applies to, and so the range the panes mark: the open candidate if
 * there is one, otherwise the user's own selection — a selection has to be visible before anything
 * is generated, or the user cannot tell what they picked (SF-087). A decided candidate stops being
 * the target; a mark is never left pointing at a range that no longer means anything.
 */
export function rewriteTarget(candidate?: { start: number; end: number; state: string }, selection?: TextRange) {
  if (candidate && candidate.state !== 'accepted' && candidate.state !== 'discarded') return { ...candidate }
  return selection ? { ...selection, state: 'selected' } : undefined
}

/** Track one target through a user's edit; editing the target itself expires the proposal.
 * beforeinput supplies the real insertion range, including when identical paragraphs make
 * a string diff ambiguous. Programmatic edits use the changed prefix/suffix interval. */
export function trackRange(range: TextRange, before: string, after: string, edit?: TextRange): TextRange | undefined {
  if (before === after) return range
  if (!edit) {
    let start = 0, end = before.length, nextEnd = after.length
    while (start < end && start < nextEnd && before[start] === after[start]) start++
    while (end > start && nextEnd > start && before[end - 1] === after[nextEnd - 1]) { end--; nextEnd-- }
    edit = { start, end }
  }
  const delta = after.length - before.length
  if (edit.end <= range.start) return { start: range.start + delta, end: range.end + delta }
  if (edit.start >= range.end) return range
  return undefined
}
