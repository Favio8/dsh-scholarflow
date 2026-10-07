/** Use measured prose lengths, not template shares, when repairing a finished draft.
 * A small global deviation only changes one suitable section; a large deviation is
 * distributed proportionally, leaving headings and other non-section prose accounted for. */
export function lengthRepairTargets(target: number, actual: number, sections: { id: string; count: number }[]) {
  const result = new Map<string, number>()
  if (actual >= target * .9 && actual <= target * 1.1) return result
  const delta = target - actual
  const ordered = [...sections].sort((a, b) => b.count - a.count)
  const largest = ordered[0]
  if (largest && Math.abs(delta) <= target * .2 && largest.count + delta >= 50) {
    result.set(largest.id, largest.count + delta)
    return result
  }
  const body = sections.reduce((sum, section) => sum + section.count, 0)
  const ratio = body ? (target - (actual - body)) / body : 1
  for (const section of sections) result.set(section.id, Math.max(50, Math.round(section.count * ratio)))
  return result
}
