import {test} from 'node:test'
import assert from 'node:assert/strict'
import {HostFileStore} from '../../src/host/gateway/file-store.ts'
test('AT-207: coherent Host observation serializes sessions without creating lock metadata or granting write capability',async()=>{
  const order:string[]=[],root='D:/TEST_ONLY_observation',host:any={}
  const binding={canonicalRoot:root,manuscriptDir:'manuscript',sessionId:'TEST_ONLY',readOnly:true,revalidate:async()=>{order.push('validate')}}
  const a=new HostFileStore(host,binding,new AbortController().signal),b=new HostFileStore(host,{...binding,sessionId:'TEST_ONLY_other'},new AbortController().signal)
  let release!:()=>void,entered!:()=>void;const held=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve)
  const first=a.observe(async()=>{order.push('a-start');entered();await held;await assert.rejects(a.write('.scholarflow/x.json','{}',undefined),{code:'PROJECT_READONLY'});await assert.rejects(a.lock(async()=>assert.fail()),{code:'PROJECT_READONLY'});order.push('a-end');return 'TEST_ONLY snapshot'})
  await started;const second=b.observe(async()=>{order.push('b');return 'TEST_ONLY next snapshot'})
  await Promise.resolve();assert.equal(order.includes('b'),false);release();assert.equal(await first,'TEST_ONLY snapshot');await second
  assert.deepEqual(order,['validate','a-start','a-end','validate','b'])
  assert.equal(Object.keys(host).length,0,'no filesystem or permission service was invoked to create read-side metadata')
})
