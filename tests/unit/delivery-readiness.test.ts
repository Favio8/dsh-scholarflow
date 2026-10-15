import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deliveryReadiness, type ReadinessInput } from '../../src/core/pipeline/readiness.ts'
const h='sha256:'+'a'.repeat(64)
const input:ReadinessInput={goal:'course-delivery',documentHash:h,revisionId:'revision_TEST_ONLY',placeholder:false,reviewStale:false,
  requiredCheckIds:['body_nonempty','argument_assessment'],advisoryCheckIds:['style_assessment'],missingMaterials:[],adoptionDecided:true,requiredFormatChecks:[],
  delivery:{documentHash:h,revisionId:'revision_TEST_ONLY',valid:true},report:{schemaVersion:1,id:'review_TEST_ONLY',projectId:'project_TEST_ONLY',documentId:'paper',documentHash:h,
    revisionId:'revision_TEST_ONLY',ledgerRevision:1,dependencyHash:h,createdAt:'2026-10-15T00:00:00Z',modelRunId:'run_TEST_ONLY',checks:[
      {id:'body_nonempty',status:'pass',method:'deterministic',detail:'TEST_ONLY actual text'},
      {id:'argument_assessment',status:'pass',method:'model-assisted',detail:'TEST_ONLY semantic check'},
      {id:'style_assessment',status:'unknown',method:'model-assisted',detail:'TEST_ONLY advisory'}],issues:[],limitations:['TEST_ONLY'],
    statistics:{chineseCharacters:0,westernWords:3,uniqueReferences:0,countingPolicyId:'TEST_ONLY'}}}
test('AT-197: unexecuted checks, missing materials, candidate adoption and unknown conditions remain distinct',()=>{
  assert.equal(deliveryReadiness({...input,report:undefined}).state,'needs-check')
  assert.equal(deliveryReadiness({...input,missingMaterials:['need actual survey']}).state,'needs-materials')
  assert.equal(deliveryReadiness({...input,pendingCandidate:true}).state,'needs-adoption')
  assert.equal(deliveryReadiness({...input,requiredFormatChecks:[{id:'pages',status:'unknown',detail:'actual pages not measured'}]}).state,'needs-verification')
  assert.equal(deliveryReadiness(input).state,'ready','advisory unknown does not block indefinitely')
  assert.equal(deliveryReadiness({...input,goal:'research-results',missingMaterials:['ablation unfinished']}).state,'research-incomplete')
})
test('AT-197: ignored B0, stale body, rules-only semantic placeholders and successful export cannot imply readiness',()=>{
  const report=structuredClone(input.report!)
  report.issues.push({id:'issue_TEST_ONLY',reviewId:report.id,category:'integrity',severity:'B0',title:'missing real result',explanation:'TEST_ONLY',claimIds:[],evidenceIds:[],requirementIds:[],checkMethod:'deterministic',state:'dismissed',stale:false})
  assert.equal(deliveryReadiness({...input,report}).state,'needs-verification')
  assert.equal(deliveryReadiness({...input,dirty:true}).state,'needs-check')
  assert.equal(deliveryReadiness({...input,report:{...input.report!,modelRunId:undefined}}).state,'needs-check')
  assert.equal(deliveryReadiness({...input,requiredCheckIds:[]}).state,'needs-verification')
  assert.equal(deliveryReadiness({...input,delivery:{...input.delivery!,documentHash:'sha256:'+'b'.repeat(64)}}).state,'needs-verification')
})
