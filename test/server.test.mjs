import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createStaticServer} from '../scripts/server.mjs';
test('local server serves the entry, engine and fixtures without allowing writes',async t=>{
 const server=createStaticServer();server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port;
 const page=await fetch(base+'/');assert.equal(page.status,200);assert.match(await page.text(),/SupervisionAudit/);
 const engine=await fetch(base+'/engine.js');assert.equal(engine.status,200);assert.match(engine.headers.get('content-type'),/javascript/);
 const data=await fetch(base+'/examples/healthy.json');assert.equal(data.status,200);assert.equal((await data.json()).contract,'causal-lm-unshifted-v1');
 assert.equal((await fetch(base+'/missing-file')).status,404);
 assert.equal((await fetch(base+'/',{method:'POST'})).status,405);
 assert.equal((await fetch(base+'/%2e%2e%2fREADME.md')).status,403);
});
