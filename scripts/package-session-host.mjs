// Package a minimal matching-version Desktop repair; never rewrite the installed app here.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, cp, readFile, writeFile, realpath } from 'node:fs/promises'
import { resolve, join, dirname, relative, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'

const source = resolve(process.argv[2] ?? '.dsh-tmp/harness-session-tasks')
const installed = resolve(process.argv[3] ?? join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness'))
const resumeIndex = process.argv.indexOf('--resume')
const out = resumeIndex >= 0 ? resolve(process.argv[resumeIndex + 1]) : resolve('.dsh-tmp/session-host-build', String(Date.now()))
const outputRoot = relative(resolve('.dsh-tmp/session-host-build'), out)
assert(outputRoot && !outputRoot.startsWith('..') && !isAbsolute(outputRoot), 'package output must be inside the repair artifact directory')
const app = join(out, 'app'), unpacked = join(out, 'archive-source')
const require = createRequire(join(source, 'apps/desktop/package.json'))
const dependencyBase = dirname(require.resolve('app-builder-lib/package.json'))
const asar = require(require.resolve('@electron/asar', { paths: [dependencyBase] }))
const fuses = require(require.resolve('@electron/fuses', { paths: [dependencyBase] }))
const archive = join(installed, 'resources/app.asar')
const manifest = JSON.parse(asar.extractFile(archive, 'package.json').toString())
assert.equal(manifest.version, '0.2.0-rc.2', 'repair must match the installed release')
const wire = await fuses.getCurrentFuseWire(join(installed, 'DeepSeek Harness.exe'))
assert.equal(wire[fuses.FuseV1Options.EnableEmbeddedAsarIntegrityValidation], '0'.charCodeAt(0),
  'the installed shell must permit a local resource repair; otherwise use a full Desktop build')
await mkdir(out, { recursive: true })
console.log(resumeIndex >= 0 ? 'Repackaging retained artifact with unpacked module directories...' : 'Copying matching installed Desktop into isolated package...')
if (resumeIndex < 0) await cp(installed, app, { recursive: true })
await mkdir(unpacked, { recursive: true })
if (resumeIndex < 0) asar.extractAll(archive, unpacked)
const records = []
for (const [name, path] of [['dsh-session', 'packages/core/session'], ['dsh-session-title', 'packages/session/session-title'], ['dsh-api-session-controller', 'packages/api/session-controller'],
  ['dsh-session-format-catalog', 'packages/session/session-format-catalog'], ['dsh-session-persistence-jsonl', 'packages/session/session-persistence-jsonl']]) {
  const destination = await realpath(join(unpacked, 'dsh/node_modules/@deepseek-ai', name))
  const inside = relative(unpacked, destination)
  assert(!inside.startsWith('..') && !isAbsolute(inside), 'package link must stay in the extracted archive')
  const pkg = JSON.parse(await readFile(join(destination, 'package.json'), 'utf8'))
  assert.equal(pkg.version, manifest.version)
  if (name === 'dsh-session-format-catalog' || name === 'dsh-session-persistence-jsonl') {
    pkg.dependencies['@deepseek-ai/dsh-session-format-v4-to-v5'] = manifest.version
    await writeFile(join(destination, 'package.json'), JSON.stringify(pkg, null, 2))
  }
  await cp(join(source, path, 'lib'), join(destination, 'lib'), { recursive: true, filter: path => !path.endsWith('.tsbuildinfo') })
  const bytes = await readFile(join(destination, 'lib/index.js'))
  records.push({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
}
const edge = join(unpacked, 'dsh/node_modules/@deepseek-ai/dsh-session-format-v4-to-v5')
await mkdir(edge, { recursive: true })
await cp(join(source, 'packages/session/session-format-v4-to-v5/lib'), join(edge, 'lib'), { recursive: true, filter: path => !path.endsWith('.tsbuildinfo') })
const edgeManifest = JSON.parse(await readFile(join(source, 'packages/session/session-format-v4-to-v5/package.json'), 'utf8'))
for (const section of ['dependencies', 'peerDependencies', 'devDependencies']) {
  for (const [name, version] of Object.entries(edgeManifest[section] ?? {})) if (version.startsWith('workspace:')) edgeManifest[section][name] = name === '@deepseek-ai/cordis' ? '~4.0.4' : manifest.version
}
await writeFile(join(edge, 'package.json'), JSON.stringify(edgeManifest, null, 2))
records.push({ name: edgeManifest.name, format: 'v4-to-v5' })
// Keep module directories unpacked instead of enumerating thousands of native files in a glob.
const originalUnpacked = asar.listPackage(archive).filter(path => {
  const entry = path.replace(/^[/\\]/, '')
  const item = asar.statFile(archive, entry, false)
  return item.unpacked && !item.files
}).map(path => path.replaceAll('\\', '/').replace(/^\//, ''))
assert(originalUnpacked.every(path => path.startsWith('dsh/node_modules/') || path.startsWith('node_modules/')),
  'unpacked entries outside module directories need a separate packaging rule')
await asar.createPackageWithOptions(unpacked, join(app, 'resources/app.asar'), { unpackDir: '**/node_modules' })
const packaged = await readFile(join(app, 'resources/app.asar'))
const report = { baseRelease: manifest.version, sessionFormat: 5, app, source, records, archiveSha256: createHash('sha256').update(packaged).digest('hex'),
  originalUnpackedFiles: originalUnpacked.length, shellChanged: false, userProfileChanged: false }
await writeFile(join(out, 'build.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
