import {test} from 'node:test'
import assert from 'node:assert/strict'
import {deliveryProgressHash,deliveryFactDebt} from '../../src/core/pipeline/delivery-drive.ts'
import type {ReviewReport} from '../../src/shared/review.ts'
test('AT-207: rewriting the same unresolved numerical problem with fresh anchors is not progress, while removing a defect is',()=>{
  const first={checks:[{id:'result_value_anchor_old',status:'fail',detail:'TEST_ONLY wrong result'}],issues:[{severity:'B0',category:'integrity',state:'open',requirementIds:[],location:{blockId:'p_old',quote:'TEST_ONLY wrong numerical assertion'}}]} as unknown as ReviewReport
  const rewritten=structuredClone(first);rewritten.checks[0].id='result_value_anchor_new';rewritten.issues[0].location!.blockId='p_new';rewritten.issues[0].location!.quote='TEST_ONLY differently worded numerical assertion'
  assert.equal(deliveryProgressHash(first),deliveryProgressHash(rewritten))
  rewritten.checks[0].status='pass';rewritten.issues=[];assert.notEqual(deliveryProgressHash(first),deliveryProgressHash(rewritten))
})

test('changing word count or suggestion text cannot reset unresolved fact debt',()=>{
  const first={checks:[{id:'own_result_numbers',status:'fail'},{id:'result_value_anchor_one',status:'fail'},{id:'requirement_writing_length_max',status:'fail'}],statistics:{westernWords:600},issues:[]} as unknown as ReviewReport
  const rewritten=structuredClone(first);rewritten.statistics.westernWords=590;rewritten.checks[1].id='result_value_anchor_two';assert.deepEqual(deliveryFactDebt(first),deliveryFactDebt(rewritten))
  rewritten.checks[1].status='pass';assert(deliveryFactDebt(rewritten)[0]<deliveryFactDebt(first)[0])
})
