import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'

await mkdir('dist', { recursive: true })
await build({ entryPoints: { host: 'src/host/plugin.ts', agent: 'src/host/agent.ts', 'parser-worker': 'src/host/parsers/worker.ts' }, outdir: 'dist', bundle: true,
  platform: 'node', format: 'esm', packages: 'external', target: 'node24', sourcemap: true })
const client = await build({ entryPoints: ['src/client/plugin.tsx'], bundle: true, write: false,
  platform: 'browser', format: 'cjs', external: ['react', 'react-dom', '@deepseek-ai/*'],
  target: 'chrome148', sourcemap: false })
await writeFile('dist/client.js', `window.__ModuleLoader__.load({id:'dsh-scholarflow',factory:(require)=>{\nconst module={exports:{}};const exports=module.exports;\n${client.outputFiles[0].text}\nreturn module.exports;}});\n`)
