import { build } from 'esbuild'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

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
// Marking `react` external also externalises `react/jsx-runtime`, because esbuild treats a
// package and its subpaths alike. The host hands over one React pair and nothing else, so a
// dependency built with the automatic JSX runtime would ask for a module that is not there.
// React's own jsx-runtime is bundled instead: it is a thin factory over `react` itself, which
// stays external, so there is still exactly one React instance.
const bundleJsxRuntime = {
  name: 'bundle-react-jsx-runtime',
  setup(pluginBuild) {
    for (const specifier of ['react/jsx-runtime', 'react/jsx-dev-runtime']) {
      pluginBuild.onResolve({ filter: new RegExp(`^${specifier}$`) }, () => ({
        path: resolve('node_modules', specifier + '.js'), external: false,
      }))
    }
  },
}
const client = await build({ entryPoints: ['src/client/plugin.tsx'], bundle: true, write: false,
  define: { __SF_KATEX_CSS__: JSON.stringify(scopedMathCss) },
  plugins: [bundleJsxRuntime],
  platform: 'browser', format: 'cjs', external: ['react', 'react-dom', '@deepseek-ai/*'],
  target: 'chrome148', sourcemap: false })
await writeFile('dist/client.js', `window.__ModuleLoader__.load({id:'dsh-scholarflow',factory:(require)=>{\nconst module={exports:{}};const exports=module.exports;\n${client.outputFiles[0].text}\nreturn module.exports;}});\n`)
