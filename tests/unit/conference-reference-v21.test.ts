import {test} from 'node:test'
import assert from 'node:assert/strict'
import {bibliography} from '../../src/core/export/bibliography.ts'
import {sourceCsl} from '../../src/core/export/apa.ts'
import {gbt7714Entry} from '../../src/core/export/citations.ts'
import type {Source,Ledger} from '../../src/shared/schema.ts'
test('verified conference metadata uses inproceedings, booktitle and the conference tag without inventing fields',()=>{
  const source={id:'source_TEST_ONLY',citeKey:'sf_TEST_ONLY',kind:'paper',title:'TEST_ONLY conference paper',authors:[{literal:'TEST_ONLY author'}],year:2026,venue:'TEST ONLY proceedings',identifiers:{doi:'10.5555/TEST_ONLY'},bibliography:{publicationType:'conference-paper'}} as Source
  const bib=bibliography('TEST_ONLY statement [@sf_TEST_ONLY]',{sources:{[source.id]:source}} as Ledger);assert(bib.startsWith('@inproceedings{'));assert(bib.includes('booktitle = {TEST ONLY proceedings}'));assert(!bib.includes('journal ='));assert(!bib.includes('publicationType ='));assert.equal(sourceCsl(source).type,'paper-conference');assert(gbt7714Entry(source,1).includes('[C]'))
})
