export type TextRange = { start: number; end: number }

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
