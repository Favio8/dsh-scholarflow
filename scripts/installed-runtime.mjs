// Read the exact Desktop archive; never patch or execute its files.
import { openSync, readSync, closeSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

export function archiveReader(path) {
  const fd = openSync(path, 'r')
  const header = Buffer.alloc(16)
  readSync(fd, header, 0, 16, 0)
  const bytes = Buffer.alloc(header.readUInt32LE(12))
  readSync(fd, bytes, 0, bytes.length, 16)
  const tree = JSON.parse(bytes.toString('utf8'))
  const base = 8 + header.readUInt32LE(4)
  function list(node = tree, prefix = '') {
    return Object.entries(node.files ?? {}).flatMap(([name, item]) =>
      item.files ? list(item, `${prefix}${name}/`) : [`${prefix}${name}`])
  }
  return {
    list,
    read(path) {
      let node = tree
      for (const part of path.split('/')) node = node?.files?.[part]
      if (!node || node.files || node.unpacked) throw new Error(`Unavailable archive entry: ${path}`)
      const buffer = Buffer.alloc(node.size)
      readSync(fd, buffer, 0, buffer.length, base + Number(node.offset))
      return buffer.toString('utf8')
    },
    close: () => closeSync(fd),
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const archive = process.env.SCHOLARFLOW_DSH_ASAR ??
    `${process.env.LOCALAPPDATA}/Programs/DeepSeek Harness/resources/app.asar`
  const reader = archiveReader(archive)
  try {
    const names = reader.list().filter(path => path.startsWith('dsh/node_modules/@deepseek-ai/'))
    if (process.argv.includes('--list')) {
      console.log([...new Set(names.map(path => path.split('/')[3]))].sort().join('\n'))
    } else {
      const packages = process.argv.slice(2)
      const root = resolve('.dsh-tmp/installed-sdk')
      let count = 0
      for (const path of names) {
        if (!packages.includes(path.split('/')[3]) || !/\.(js|ts|json|md)$/.test(path)) continue
        const target = resolve(root, path.slice('dsh/node_modules/@deepseek-ai/'.length))
        const rel = relative(root, target)
        if (isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) throw new Error('Unsafe archive path')
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, reader.read(path), 'utf8')
        count++
      }
      console.log(`Read ${count} installed SDK files into .dsh-tmp/installed-sdk`)
    }
  } finally { reader.close() }
}
