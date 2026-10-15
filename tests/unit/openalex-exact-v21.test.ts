import {test} from 'node:test'
import assert from 'node:assert/strict'
import {openAlexSearch} from '../../src/host/providers/openalex.ts'
test('AT-194: an explicit DOI resolves the exact work without excluding a closed-indexed paper with a user-provided public original',async()=>{
  let requested='';const web={async fetch({url}:{url:string}){requested=url;return {url,statusCode:200,truncated:false,body:{kind:'text',content:JSON.stringify({id:'https://openalex.org/W1',title:'TEST_ONLY exact work',doi:'https://doi.org/10.5555/test_only',locations:[]})}}}}
  const result=await openAlexSearch(web,'10.5555/test_only',new AbortController().signal);assert.equal(result.length,1);assert(new URL(requested).pathname.includes('/works/https://doi.org/'));assert(!new URL(requested).searchParams.has('filter'))
})

test('explicit original URLs match the exact sole DOI instead of a DOI prefix or mixed citation line',async()=>{const {specifiedOriginalUrls}=await import('../../src/core/research/online.ts');assert.deepEqual(specifiedOriginalUrls('DOI 10.5555/abc123 | https://example.org/wrong.pdf','10.5555/abc'),[]);assert.deepEqual(specifiedOriginalUrls('DOI 10.5555/abc 10.5555/other | https://example.org/ambiguous.pdf','10.5555/abc'),[]);assert.deepEqual(specifiedOriginalUrls('DOI 10.5555/ABC | https://example.org/right.pdf','10.5555/abc'),['https://example.org/right.pdf'])})
