import { build } from 'esbuild'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

await mkdir('dist', { recursive: true })
await build({ entryPoints: { host: 'src/host/plugin.ts', agent: 'src/host/agent.ts', 'parser-worker': 'src/host/parsers/worker.ts' }, outdir: 'dist', bundle: true,
  platform: 'node', format: 'esm', packages: 'external', target: 'node24', sourcemap: true })

// KaTeX ships its own stylesheet and fonts; both are inlined so the preview needs no network.
let mathCss = await readFile('node_modules/katex/dist/katex.min.css', 'utf8')
const fontUrls = [...new Set([...mathCss.matchAll(/url\((fonts\/[^)]+)\)/g)].map(match => match[1]))]
for (const path of fontUrls) {
  const bytes = await readFile(resolve('node_modules/katex/dist', path))
  const mime = path.endsWith('.woff2') ? 'font/woff2' : path.endsWith('.woff') ? 'font/woff' : 'font/ttf'
  mathCss = mathCss.replaceAll(`url(${path})`, `url(data:${mime};base64,${bytes.toString('base64')})`)
}
const fontFaces = [...mathCss.matchAll(/@font-face\{[^}]+\}/g)].map(match => match[0]).join('')
const scopedMathCss = fontFaces + '@scope (.sf-app){' + mathCss.replace(/@font-face\{[^}]+\}/g, '') + '}'

/**
 * Marking `react` external also externalises `react/jsx-runtime`, because esbuild treats a
 * package and its subpaths alike. A dependency built with the automatic JSX runtime would then
 * ask the host for a module it does not provide. React's own file cannot simply be bundled
 * instead: it chooses its development or production build from `process.env`, which is not
 * defined in this bundle, and the development build reads shared internals the host's React
 * does not carry — that combination took the whole surface down with
 * `Cannot read properties of undefined (reading 'recentlyCreatedOwnerStacks')`.
 *
 * The runtime is therefore provided by a shim over `React.createElement`: one React, no
 * internals, and no dependency on a build-time constant.
 */
const jsxRuntimeShim = {
  name: 'alias-react-jsx-runtime',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^react\/(jsx-runtime|jsx-dev-runtime)$/ }, () => ({
      path: resolve('src/client/motion/jsx-runtime.ts'), external: false,
    }))
  },
}

const client = await build({ entryPoints: ['src/client/plugin.tsx'], bundle: true, write: false,
  define: { __SF_KATEX_CSS__: JSON.stringify(scopedMathCss) },
  plugins: [jsxRuntimeShim],
  platform: 'browser', format: 'cjs', external: ['react', 'react-dom', '@deepseek-ai/*'],
  target: 'chrome148', sourcemap: false })
await writeFile('dist/client.js', `window.__ModuleLoader__.load({id:'dsh-scholarflow',factory:(require)=>{\nconst module={exports:{}};const exports=module.exports;\n${client.outputFiles[0].text}\nreturn module.exports;}});\n`)
