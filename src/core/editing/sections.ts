import { parseMarkdown, projectMarkdown, textOf, walk } from './markdown.ts'
import { invariant } from '../../shared/errors.ts'
import { sectionCandidateSchema } from '../../shared/editing.ts'
import type { Outline } from '../../shared/schema.ts'
import type { z } from 'zod'

const titleKey = (title: string) => title.normalize('NFC').trim().replace(/\s+/gu, ' ')
export function outlineOrder(outline: Outline) {
  const ordered: Outline['sections'] = [], seen = new Set<string>()
  const visit = (parentId?: string) => {
    for (const section of outline.sections.filter(row => row.parentId === parentId)) {
      invariant(!seen.has(section.id), 'OUTLINE_INVALID', '大纲章节标识重复或循环。')
      seen.add(section.id); ordered.push(section); visit(section.id)
    }
  }
  visit()
  invariant(ordered.length === outline.sections.length, 'OUTLINE_INVALID', '大纲存在无法定位的父章节或循环。')
  return ordered
}

// Heading positions come exclusively from the positioned Markdown AST. Titles
// are matched exactly after whitespace/NFC normalization, never by similarity.
export function sectionTarget(source: string, outline: Outline, sectionId: string) {
  invariant(outline.confirmation === 'confirmed', 'OUTLINE_CONFIRMATION_REQUIRED', '章节生成需要已确认大纲。')
  const ordered = outlineOrder(outline), section = ordered.find(row => row.id === sectionId)
  invariant(section, 'OUTLINE_SECTION_NOT_FOUND', '所选大纲章节不存在。')
  let depth = 2, ancestor = section
  while (ancestor.parentId) { depth++; ancestor = ordered.find(row => row.id === ancestor.parentId)! }
  invariant(depth <= 6, 'SECTION_SCOPE_UNSUPPORTED', '章节层级超过 Markdown 六级标题，不能安全生成。')
  const title = titleKey(section.title)
  invariant(ordered.filter(row => titleKey(row.title) === title).length === 1, 'SECTION_TARGET_AMBIGUOUS', '大纲存在相同章节标题；请先明确标题，不能猜测目标章节。')
  const headings = (parseMarkdown(source).children ?? []).filter(node => node.type === 'heading').map(node => ({
    title: titleKey(textOf(node)), depth: node.depth!, start: node.position!.start.offset!, end: node.position!.end.offset!,
  }))
  const matches = headings.filter(heading => heading.title === title)
  invariant(matches.length <= 1, 'SECTION_TARGET_AMBIGUOUS', '正文存在多个相同章节标题；未猜测修改目标。')
  const heading = matches[0]
  if (heading) {
    invariant(heading.depth === depth, 'SECTION_SCOPE_UNSUPPORTED', '正文标题层级与已确认大纲不一致，请先手工对齐。')
    if (section.parentId) {
      const parent = ordered.find(row => row.id === section.parentId)!
      const enclosing = headings.filter(row => row.start < heading.start && row.depth < depth).at(-1)
      invariant(enclosing?.depth === depth - 1 && enclosing.title === titleKey(parent.title), 'SECTION_SCOPE_UNSUPPORTED', '正文父章节与大纲不一致。')
    }
    // Keep the existing heading and every following subsection/section intact.
    const next = headings.find(row => row.start > heading.start)
    return { sectionId, title: section.title, depth, mode: 'replace-body' as const,
      startUtf16: heading.end, endUtf16: next?.start ?? source.length }
  }
  if (section.parentId) {
    const parent = ordered.find(row => row.id === section.parentId)!
    invariant(headings.filter(row => row.title === titleKey(parent.title) && row.depth === depth - 1).length === 1,
      'SECTION_PARENT_REQUIRED', '先生成或手工保存父章节标题，再生成子章节。')
  }
  const index = ordered.indexOf(section)
  const known = ordered.map(row => {
    const matches = headings.filter(heading => heading.title === titleKey(row.title))
    invariant(matches.length <= 1, 'SECTION_TARGET_AMBIGUOUS', '正文存在重复大纲标题，不能确定新章节插入位置。')
    return matches[0]
  })
  const positions = known.filter(Boolean).map(row => row!.start)
  invariant(positions.every((offset, i) => i === 0 || offset > positions[i - 1]), 'SECTION_ORDER_CONFLICT', '正文章节顺序与大纲不一致，先手工确认顺序。')
  const following = known.slice(index + 1).find(Boolean)
  const preceding = known.slice(0, index).filter(Boolean).at(-1)
  const boundary = preceding && headings.find(row => row.start > preceding.start && row.depth <= depth)
  const offset = following?.start ?? boundary?.start ?? source.length
  invariant(!section.parentId || preceding && offset > preceding.start, 'SECTION_SCOPE_UNSUPPORTED', '子章节无法定位到已保存的父章节之后。')
  // A new heading must not become a child of an unrelated existing section.
  if (section.parentId) {
    const parentTitle = titleKey(ordered.find(row => row.id === section.parentId)!.title)
    const enclosing = headings.filter(row => row.start < offset && row.depth < depth).at(-1)
    invariant(enclosing?.title === parentTitle && enclosing.depth === depth - 1, 'SECTION_SCOPE_UNSUPPORTED', '插入位置不在所选父章节中，请先手工对齐大纲与正文。')
  }
  return { sectionId, title: section.title, depth, mode: 'insert' as const, startUtf16: offset, endUtf16: offset }
}

export function sectionEdit(source: string, outline: Outline, raw: z.infer<typeof sectionCandidateSchema>) {
  const candidate = sectionCandidateSchema.parse(raw), target = sectionTarget(source, outline, candidate.sectionId)
  invariant(candidate.outlineVersion === outline.version, 'STALE_OUTLINE_VERSION', '章节候选基于旧大纲，未应用。')
  invariant(candidate.body.trim() && candidate.body.isWellFormed(), 'SECTION_OUTPUT_INVALID', '章节正文为空或包含无效 Unicode。')
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const body = candidate.body.replace(/\r\n|\r|\n/g, newline).trim()
  const tree = parseMarkdown(body)
  walk(tree, node => { if (node.type === 'heading') invariant(node.depth! > target.depth &&
    !outline.sections.some(row => titleKey(row.title) === titleKey(textOf(node))), 'SECTION_OUTPUT_INVALID', '候选包含目标章节或其他大纲章节的标题，可能改变范围；只返回本节正文。') })
  const blocks = projectMarkdown(body).blocks
  const allowed = new Set(outline.sections.find(row => row.id === candidate.sectionId)!.claimIds)
  invariant(candidate.paragraphClaims.length === blocks.length && new Set(candidate.paragraphClaims.map(row => row.paragraphIndex)).size === blocks.length,
    'SECTION_CLAIM_MAPPING_INVALID', '每个正文段落必须有唯一的零起始论点映射；无对应论点时使用空数组并说明缺口。')
  for (const row of candidate.paragraphClaims) invariant(row.paragraphIndex < blocks.length && new Set(row.claimIds).size === row.claimIds.length &&
    row.claimIds.every(id => allowed.has(id)), 'SECTION_CLAIM_MAPPING_INVALID', '段落论点映射越界、重复或不属于所选章节。')
  // A first-line title is literal text, not executable Markdown markup supplied
  // by a user title. Reject multiline/markup titles instead of silently changing it.
  if (target.mode === 'insert') invariant(!/[\r\n]/.test(target.title) && textOf((parseMarkdown(`${'#'.repeat(target.depth)} ${target.title}`).children ?? [])[0]) === target.title.trim(),
    'SECTION_TITLE_UNSUPPORTED', '标题包含 Markdown 结构或换行，请先使用普通文字标题。')
  const prefix = target.mode === 'insert' ? `${target.startUtf16 && !source.slice(0, target.startUtf16).endsWith(newline + newline) ? newline + newline : ''}${'#'.repeat(target.depth)} ${target.title}${newline}${newline}` : newline + newline
  const replacementText = prefix + body + newline + newline
  return { target, body, bodyOffset: prefix.length, blocks,
    edit: { startUtf16: target.startUtf16, endUtf16: target.endUtf16, expectedText: source.slice(target.startUtf16, target.endUtf16), replacementText } }
}
