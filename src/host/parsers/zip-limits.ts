import { invariant } from '../../shared/errors.ts'

// Preflight the central directory BEFORE any decompression. A bounded worker
// supplies a second memory/time boundary for misleading container metadata.
export function inspectDocxZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { eocd = offset; break }
  }
  invariant(eocd >= 0, 'DOCX_INVALID_CONTAINER', 'DOCX ZIP 目录无效。')
  invariant(view.getUint16(eocd + 4, true) === 0 && view.getUint16(eocd + 6, true) === 0, 'DOCX_UNSUPPORTED_CONTAINER', '不支持分卷 DOCX。')
  const count = view.getUint16(eocd + 10, true), start = view.getUint32(eocd + 16, true), length = view.getUint32(eocd + 12, true)
  invariant(count <= 250 && count !== 65535 && start + length <= eocd, 'DOCX_CONTAINER_LIMIT', 'DOCX 文件数量或目录超过安全限额。')
  const entries: Array<{ name: string; size: number }> = []
  let offset = start, total = 0
  for (let index = 0; index < count; index++) {
    invariant(offset + 46 <= start + length && view.getUint32(offset, true) === 0x02014b50, 'DOCX_INVALID_CONTAINER', 'DOCX ZIP 条目无效。')
    const flags = view.getUint16(offset + 8, true), compressed = view.getUint32(offset + 20, true), size = view.getUint32(offset + 24, true)
    const nameSize = view.getUint16(offset + 28, true), extra = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true)
    const next = offset + 46 + nameSize + extra + comment
    invariant(next <= start + length && !(flags & 1), 'DOCX_UNSUPPORTED_CONTAINER', '不支持加密或损坏的 DOCX。')
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + nameSize))
    invariant(!name.startsWith('/') && !name.includes('\\') && !name.split('/').includes('..') && !name.includes('\0'), 'DOCX_INVALID_CONTAINER', 'DOCX ZIP 路径不安全。')
    total += size
    invariant(size <= 10 * 1024 * 1024 && total <= 50 * 1024 * 1024 && size <= Math.max(compressed * 100, 65536), 'DOCX_CONTAINER_LIMIT', 'DOCX 解压体积或压缩倍数超过限额。')
    invariant(!entries.some(entry => entry.name === name), 'DOCX_INVALID_CONTAINER', 'DOCX ZIP 包含重复条目。')
    entries.push({ name, size }); offset = next
  }
  invariant(offset === start + length && entries.some(entry => entry.name === 'word/document.xml'), 'DOCX_INVALID_CONTAINER', 'DOCX 缺少主文档。')
  return entries
}
