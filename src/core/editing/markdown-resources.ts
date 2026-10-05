import { posix } from 'node:path'
import { decodeString } from 'micromark-util-decode-string'
import { parseMarkdown, walk, type AstNode } from './markdown.ts'
import { relativePath } from '../../shared/schema.ts'
import { invariant } from '../../shared/errors.ts'
import { sensitivePath } from '../materials/materials.ts'

export interface MarkdownDestination { nodeType: string; url: string; startUtf16: number; endUtf16: number; raw: string }
const escaped = (source: string, at: number) => { let n = 0; for (let i = at - 1; i >= 0 && source[i] === '\\'; i--) n++; return n % 2 === 1 }
function destination(source: string, cursor: number) {
  while (/\s/u.test(source[cursor] ?? '') && cursor < source.length) cursor++
  const angle = source[cursor] === '<', start = cursor + Number(angle)
  cursor = start; let depth = 0
  while (cursor < source.length) {
    const character = source[cursor]
    if (character === '\\' && cursor + 1 < source.length) { cursor += 2; continue }
    if (angle ? character === '>' : /\s/u.test(character) || character === ')' && depth === 0) break
    if (angle && /[\r\n]/u.test(character)) return undefined
    if (!angle && character === '(') { if (++depth > 16) return undefined }
    if (!angle && character === ')') depth--
    cursor++
  }
  if (cursor === start || depth !== 0 || angle && source[cursor] !== '>') return undefined
  return { start, end: cursor, raw: source.slice(start, cursor) }
}
function locate(source: string, node: AstNode): MarkdownDestination {
  const start = node.position?.start.offset, end = node.position?.end.offset
  invariant(start !== undefined && end !== undefined && start >= 0 && end <= source.length && end > start, 'MARKDOWN_RESOURCE_UNSUPPORTED', '资源地址缺少可靠的源码位置。')
  const raw = source.slice(start, end), candidates: ReturnType<typeof destination>[] = []
  if (node.type === 'link' && /^(?:https?:|mailto:)/iu.test(node.url ?? '')) {
    const plain = node.url!.replace(/^mailto:/iu, '')
    if (raw === node.url || raw === `<${node.url}>` || raw === `<${plain}>` || raw === plain)
      return { nodeType: node.type, url: node.url!, startUtf16: start, endUtf16: end, raw }
  }
  if (node.type === 'definition') {
    const prefix = /^[ \t]{0,3}\[(?:\\.|[^\]\\])+\]:[ \t]*/u.exec(raw)
    if (prefix) candidates.push(destination(raw, prefix[0].length))
  } else {
    for (let index = 0; index + 1 < raw.length; index++) if (raw[index] === ']' && raw[index + 1] === '(' && !escaped(raw, index))
      candidates.push(destination(raw, index + 2))
  }
  const matching = candidates.filter(candidate => candidate && decodeString(candidate.raw) === node.url)
  invariant(matching.length === 1 && matching[0], 'MARKDOWN_RESOURCE_UNSUPPORTED', '资源地址的源码表示不唯一或超出已验证语法，未猜测替换位置。')
  const match = matching[0]
  return { nodeType: node.type, url: node.url!, startUtf16: start + match.start, endUtf16: start + match.end, raw: match.raw }
}
export function markdownDestinations(source: string) {
  const rows: MarkdownDestination[] = []
  walk(parseMarkdown(source), node => { if (['link', 'image', 'definition'].includes(node.type) && node.url) rows.push(locate(source, node)) })
  rows.sort((a, b) => a.startUtf16 - b.startUtf16)
  for (let i = 1; i < rows.length; i++) invariant(rows[i - 1].endUtf16 <= rows[i].startUtf16, 'MARKDOWN_RESOURCE_UNSUPPORTED', '资源地址位置重叠，未修改原稿。')
  return rows
}
export function projectRelativeUrl(sourcePath: string, destinationPath: string, url: string) {
  relativePath.parse(sourcePath); relativePath.parse(destinationPath)
  if (/^(?:https?:|mailto:)/iu.test(url) || url.startsWith('#')) return { url, target: undefined }
  invariant(!/^(?:[a-z][a-z0-9+.-]*:|\/|\\)/iu.test(url), 'PRIVATE_LINK_NOT_IMPORTABLE', '导入稿包含绝对、危险或未支持的资源地址，请先明确改为项目内相对资源。')
  const split = url.search(/[?#]/u), path = split < 0 ? url : url.slice(0, split), suffix = split < 0 ? '' : url.slice(split)
  invariant(path.length > 0, 'MARKDOWN_RESOURCE_UNSUPPORTED', '仅查询参数的资源地址未验证，未猜测其目标。')
  let decoded: string
  try { decoded = decodeURIComponent(path) } catch { invariant(false, 'MARKDOWN_RESOURCE_UNSUPPORTED', '资源地址百分号编码无效。') }
  invariant(!/[\\:\0]/u.test(decoded!) && !decoded!.startsWith('/'), 'PRIVATE_LINK_NOT_IMPORTABLE', '资源地址包含未支持的路径编码。')
  const target = posix.normalize(posix.join(posix.dirname(sourcePath), decoded!)).replace(/\/$/u, '')
  if (target !== '.') relativePath.parse(target)
  invariant(!sensitivePath(target) && target.toLowerCase() !== '.scholarflow' && !target.toLowerCase().startsWith('.scholarflow/'), 'MATERIAL_ACCESS_DENIED', '稿件资源不能指向凭据或项目元数据。')
  const relative = posix.relative(posix.dirname(destinationPath), target) || '.'
  const encoded = relative.split('/').map(segment => encodeURIComponent(segment).replace(/[!'()*]/gu, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)).join('/')
  return { url: encoded + (decoded!.endsWith('/') ? '/' : '') + suffix, target }
}
export function relocateMarkdownResources(text: string, sourcePath: string, destinationPath: string) {
  const changes = markdownDestinations(text).flatMap(row => {
    const resolved = projectRelativeUrl(sourcePath, destinationPath, row.url)
    return resolved.url === row.url ? [] : [{ ...row, replacement: resolved.url, projectRelativeTarget: resolved.target! }]
  })
  let relocated = text
  for (const row of [...changes].reverse()) relocated = relocated.slice(0, row.startUtf16) + row.replacement + relocated.slice(row.endUtf16)
  parseMarkdown(relocated)
  return { text: relocated, changes }
}
