import { build } from 'esbuild'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'

await mkdir('dist', { recursive: true })
await build({ entryPoints: { host: 'src/host/plugin.ts', agent: 'src/host/agent.ts', 'parser-worker': 'src/host/parsers/worker.ts' }, outdir: 'dist', bundle: true,
  platform: 'node', format: 'esm', packages: 'external', target: 'node24', sourcemap: true })
let mathCss = await readFile('node_modules/katex/dist/katex.min.css', 'utf8')
const fontUrls = [...new Set([...mathCss.matchAll(/url\((fonts\/[^)]+)\)/g)].map(match => match[1]))]
for (const path of fontUrls) {
  const bytes = await readFile(join('node_modules/katex/dist', path))
  const mime = path.endsWith('.woff2') ? 'font/woff2' : path.endsWith('.woff') ? 'font/woff' : 'font/ttf'
  mathCss = mathCss.replaceAll(`url(${path})`, `url(data:${mime};base64,${bytes.toString('base64')})`)
}
const fontFaces = [...mathCss.matchAll(/@font-face\{[^}]+\}/g)].map(match => match[0]).join('')
const scopedMathCss = fontFaces + '@scope (.sf-app){' + mathCss.replace(/@font-face\{[^}]+\}/g, '') + '}'
const client = await build({ entryPoints: ['src/client/plugin.tsx'], bundle: true, write: false,
  define: { __SF_KATEX_CSS__: JSON.stringify(scopedMathCss) },
  platform: 'browser', format: 'cjs', external: ['react', 'react-dom', '@deepseek-ai/*'],
  target: 'chrome148', sourcemap: false })
await writeFile('dist/client.js', `window.__ModuleLoader__.load({id:'dsh-scholarflow',factory:(require)=>{\nconst module={exports:{}};const exports=module.exports;\n${client.outputFiles[0].text}\nreturn module.exports;}});\n`)
