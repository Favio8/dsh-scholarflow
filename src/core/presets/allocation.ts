// Deterministic chapter-length allocation (SPEC v1.1 §8.2). Pure: the wizard, the
// project editor and the quality report all call this, so a restored project cannot
// disagree with what the user confirmed.
//
// Rules implemented here, in the order the contract states them:
//   1. manual chapters and the counted abstract are reserved first;
//   2. the remainder is distributed by weight, with a floor pass for the minimum;
//   3. an insufficient budget never overwrites a value — it is reported instead;
//   4. no automatic chapter means no recalculation, only a reported difference.

export const MINIMUM_SECTION_LENGTH = 50

export interface AllocationSection {
  id: string
  targetLength: number
  allocationMode: 'auto' | 'manual'
  allocationWeight?: number
}
export interface AllocationResult {
  sections: AllocationSection[]
  /** Manual total + counted abstract + allocated automatic total. */
  total: number
  /** How far the plan falls short of the target. */
  shortfall: number
  /** How far the plan exceeds the target. */
  overage: number
  /** True when the automatic chapters cannot each reach the minimum. */
  minimumShortfall: boolean
  /** User-facing explanations; empty when the plan is exactly on target. */
  notes: string[]
}
export interface AllocationOptions {
  abstractLength?: number
  includeAbstract?: boolean
  minimum?: number
}

export function allocate(sections: AllocationSection[], target: number, options: AllocationOptions = {}): AllocationResult {
  const minimum = options.minimum ?? MINIMUM_SECTION_LENGTH
  const abstract = options.includeAbstract ? Math.max(0, Math.round(options.abstractLength ?? 0)) : 0
  const manualTotal = sections.filter(section => section.allocationMode === 'manual').reduce((sum, section) => sum + section.targetLength, 0)
  const auto = sections.filter(section => section.allocationMode === 'auto')
  const notes: string[] = []

  const settled = (values: Map<string, number>): AllocationResult => {
    const allocated = auto.reduce((sum, section) => sum + (values.get(section.id) ?? section.targetLength), 0)
    const total = manualTotal + abstract + allocated
    if (total > target) notes.push(`当前计划超出目标 ${total - target} 字，请提高目标、调整手工章节或恢复自动分配。`)
    else if (total < target) notes.push(`当前计划比目标少 ${target - total} 字，请确认后再创建。`)
    return { sections: sections.map(section => ({ ...section, targetLength: values.get(section.id) ?? section.targetLength })),
      total, shortfall: Math.max(0, target - total), overage: Math.max(0, total - target), minimumShortfall: false, notes }
  }

  // Rule 4: nothing to distribute. Keep every value and report the difference.
  if (!auto.length) return settled(new Map())

  const budget = target - manualTotal - abstract
  // Rule 3: not enough room for the minimum. Do not touch a single value.
  if (budget < minimum * auto.length) {
    const needed = manualTotal + abstract + minimum * auto.length
    const total = manualTotal + abstract + auto.reduce((sum, section) => sum + section.targetLength, 0)
    return { sections: [...sections], total, shortfall: Math.max(0, target - total), overage: Math.max(0, total - target),
      minimumShortfall: true,
      notes: [`自动章节每章至少 ${minimum} 字，共需 ${minimum * auto.length} 字；当前可分配 ${Math.max(0, budget)} 字。`,
        `把目标提高到至少 ${needed} 字，或减少章节、调整手工篇幅后再创建。`] }
  }

  // Rule 2a: floor pass. Any chapter whose weighted share is under the minimum takes
  // the minimum and leaves the weighted pool; the rest are recomputed without it.
  const values = new Map<string, number>()
  let pool = budget
  let remaining = [...auto]
  for (let guard = 0; guard <= auto.length; guard++) {
    const totalWeight = remaining.reduce((sum, section) => sum + (section.allocationWeight ?? 1), 0)
    const below = remaining.filter(section => (pool * (section.allocationWeight ?? 1)) / totalWeight < minimum)
    if (!below.length) break
    for (const section of below) { values.set(section.id, minimum); pool -= minimum }
    remaining = remaining.filter(section => !values.has(section.id))
    if (!remaining.length) break
  }
  // Rule 2b: proportional split, floored, then largest remainders take the leftover
  // unit so the total lands exactly on the target (ties break by chapter order).
  if (remaining.length) {
    const totalWeight = remaining.reduce((sum, section) => sum + (section.allocationWeight ?? 1), 0)
    const exact = remaining.map(section => ({ id: section.id, value: (pool * (section.allocationWeight ?? 1)) / totalWeight }))
    const rows = exact.map(row => ({ ...row, base: Math.floor(row.value), fraction: row.value - Math.floor(row.value) }))
    let leftover = pool - rows.reduce((sum, row) => sum + row.base, 0)
    const byRemainder = [...rows].sort((a, b) => b.fraction - a.fraction
      || auto.findIndex(section => section.id === a.id) - auto.findIndex(section => section.id === b.id))
    for (const row of byRemainder) { if (leftover <= 0) break; row.base += 1; leftover -= 1 }
    for (const row of rows) values.set(row.id, row.base)
  }
  return settled(values)
}

/** Recomputes only the automatic chapters; manual values are never touched. */
export function reallocate(sections: AllocationSection[], target: number, options: AllocationOptions = {}) {
  return allocate(sections, target, options)
}

/** Turns the edited chapter into a manual one; titles and order leave this untouched. */
export function lockSection(sections: AllocationSection[], id: string, targetLength: number): AllocationSection[] {
  return sections.map(section => section.id === id ? { ...section, targetLength, allocationMode: 'manual' } : section)
}

/** Hands one chapter back to the automatic pool, using the preset share when known. */
export function releaseSection(sections: AllocationSection[], id: string, weight?: number): AllocationSection[] {
  return sections.map(section => section.id === id ? { ...section, allocationMode: 'auto', ...(weight === undefined ? {} : { allocationWeight: weight }) } : section)
}

/** A new chapter joins the automatic pool with the average weight of its peers. */
export function appendAutoSection(sections: AllocationSection[], id: string, title: string, minimum = MINIMUM_SECTION_LENGTH): AllocationSection[] {
  const peers = sections.filter(section => section.allocationMode === 'auto')
  const weight = peers.length ? peers.reduce((sum, section) => sum + (section.allocationWeight ?? 1), 0) / peers.length : 1
  return [...sections, { id, targetLength: minimum, allocationMode: 'auto', allocationWeight: weight }]
}
