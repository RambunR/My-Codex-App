import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blocksPublicDriveTick,isInternalDriveTick,dispatchDriveTick,DRIVE_IMPORT_INTERNAL_URL,DRIVE_IMPORT_INTERNAL_PATH} from '../cloudflare/drive-import-dispatch.js';

test('all public methods and hosts block the reserved path, including queries',()=>{
  for(const origin of ['https://lingyingdrama.com','https://lingying.jimmy-tsoi2001.workers.dev','https://internal.lingying.invalid'])
    for(const method of ['GET','POST','PUT','DELETE','OPTIONS'])
      assert.equal(blocksPublicDriveTick(new Request(`${origin}${DRIVE_IMPORT_INTERNAL_PATH}?scan=1`,{method})),true);
  assert.equal(blocksPublicDriveTick(new Request('https://lingyingdrama.com/api/health')),false);
});
test('scheduler dispatches through its stub, not a public network request',async()=>{
  let calls=0;
  await dispatchDriveTick({fetch:async request=>{calls++;assert.equal(request.url,DRIVE_IMPORT_INTERNAL_URL);assert.equal(isInternalDriveTick(request),true);return new Response('{}');}});
  assert.equal(calls,1);
  assert.equal(isInternalDriveTick(new Request(DRIVE_IMPORT_INTERNAL_URL)),false);
  assert.equal(isInternalDriveTick(new Request(DRIVE_IMPORT_INTERNAL_URL+'?scan=1',{method:'POST'})),false);
  assert.equal(isInternalDriveTick(new Request('https://lingyingdrama.com'+DRIVE_IMPORT_INTERNAL_PATH,{method:'POST'})),false);
});
