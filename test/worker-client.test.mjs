import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngineClient } from '../web/engine-client.js';

class ControlledWorker {
  terminated = false;
  postMessage(request) { this.request = request; }
  terminate() { this.terminated = true; }
  deliver(data) { this.onmessage({ data }); }
}
const setup = () => {
  const workers = [];
  const client = createEngineClient(() => {
    const worker = new ControlledWorker(); workers.push(worker); return worker;
  });
  return { workers, client };
};

test('cancellation terminates work and late messages cannot settle a newer request', async () => {
  const {client, workers} = setup();
  const first = client.run({kind:'audit',text:'first'});
  const cancelled = assert.rejects(first,{name:'AbortError'});
  const current = client.run({kind:'audit',text:'current'});
  await cancelled;
  assert.equal(workers[0].terminated,true);
  let resolved = false;
  current.then(()=>{resolved=true;});
  workers[0].deliver({result:{id:'obsolete'}});
  workers[0].onerror({message:'obsolete failure'});
  await Promise.resolve();
  assert.equal(resolved,false);
  workers[1].deliver({result:{id:'current'}});
  assert.deepEqual(await current,{id:'current'});
  assert.equal(workers[1].terminated,true);
});

test('explicit cancel is idempotent and leaves the client reusable', async () => {
  const {client, workers} = setup();
  const pending = client.run({kind:'compare'});
  const cancelled = assert.rejects(pending,{name:'AbortError'});
  client.cancel(); client.cancel(); await cancelled;
  const next = client.run({kind:'audit'});
  workers[1].deliver({result:{ok:false,error:'Malformed input'}});
  assert.deepEqual(await next,{ok:false,error:'Malformed input'});
  assert.equal(workers.every(worker=>worker.terminated),true);
});

test('worker transport and startup failures reject visibly and clean up', async () => {
  for (const signal of ['error','messageerror','malformed','thrown']) {
    const {client, workers} = setup();
    const pending = client.run({kind:'audit'});
    const failed = assert.rejects(pending);
    const worker = workers[0];
    if (signal==='error') worker.onerror({message:'module unavailable',preventDefault(){}});
    if (signal==='messageerror') worker.onmessageerror();
    if (signal==='malformed') worker.deliver({unexpected:true});
    if (signal==='thrown') worker.deliver({error:'job failed'});
    await failed; assert.equal(worker.terminated,true);
  }
  const client = createEngineClient(()=>{throw new Error('Worker disabled');});
  await assert.rejects(client.run({kind:'audit'}),/Worker disabled/);
  client.cancel();
});

test('postMessage cloning failure terminates the new worker', async () => {
  const worker = new ControlledWorker();
  worker.postMessage=()=>{throw new Error('Cannot clone');};
  const client=createEngineClient(()=>worker);
  await assert.rejects(client.run({kind:'audit'}),/Cannot clone/);
  assert.equal(worker.terminated,true);
});
