import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
const output=resolve('.dsh-tmp/contracts/product-diff.mjs');await mkdir(resolve('.dsh-tmp/contracts'),{recursive:true})
await build({entryPoints:['src/client/rewrite-candidate.tsx'],outfile:output,bundle:true,platform:'node',format:'esm',packages:'external'})
const {diffSegments}=await import(pathToFileURL(output).href)
test('version diff preserves exact before/after strings and scales to a long changed manuscript',()=>{
  for(const [before,after] of [['TEST_ONLY old value and stable end','TEST_ONLY new value and stable end'],['相同段落\n\n原句。\n\n相同段落','相同段落\n\n新句。\n\n相同段落'],['TEST_ONLY\n'+'甲'.repeat(30000),'TEST_ONLY\n'+'乙'.repeat(30000)]]){
    const changes=diffSegments(before,after)
    assert.equal(changes.filter(row=>row.kind!=='add').map(row=>row.text).join(''),before)
    assert.equal(changes.filter(row=>row.kind!=='remove').map(row=>row.text).join(''),after)
  }
})
