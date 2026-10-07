export type TextRange = { start: number; end: number }

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
