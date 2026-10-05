import { BrowserWorker } from './helpers/browser-worker.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

class Node {
  constructor() { this.children=[]; this.value=''; this.textContent=''; this.style={}; this.files=[]; this.classList={toggle(){}}; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children=children; }
  setAttribute() {}
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve=yes; reject=no; });
  return { promise, resolve, reject };
}

test('baseline reads respect replacement, clearing and input changes', async t => {
  const oldWorker=globalThis.Worker; globalThis.Worker=BrowserWorker;
  t.after(()=>{globalThis.Worker=oldWorker;});
  const nodes=new Map();
  const get=id=>{ if (!nodes.has(id)) nodes.set(id,new Node()); return nodes.get(id); };
  get('preset').value='pretraining'; get('filter').value='all';
  const oldDocument=globalThis.document, oldFetch=globalThis.fetch;
  t.after(()=>{globalThis.document=oldDocument; globalThis.fetch=oldFetch;});
  globalThis.document={getElementById:get,createElement:()=>new Node()};
  globalThis.fetch=async path=>({ok:true,json:async()=>JSON.parse(await readFile(new URL('../web/'+path,import.meta.url),'utf8'))});
  await import('../web/app.js');
  const good=await readFile(new URL('../examples/pretraining.json',import.meta.url),'utf8');
  const bad=await readFile(new URL('../examples/pretraining-boundary.json',import.meta.url),'utf8');
  const select=(name,text,size=100)=>{
    get('baseline').files=[{name,size,text}];
    return get('baseline').onchange();
  };
  const heading=()=>get('comparison').children[0].children[0].textContent;

  await t.test('newer file wins even when the earlier read finishes last',async()=>{
    const pending=deferred();
    const earlier=select('old.json',()=>pending.promise);
    await select('new.json',async()=>good);
    assert.match(heading(),/^new.json/);
    pending.resolve(bad); await earlier;
    assert.match(heading(),/^new.json/);
    assert.match(get('comparison').children[0].children[1].textContent,/0 项新增问题 · 0 项已消失问题/);
  });

  await t.test('clear cancels a pending read instead of resurrecting it',async()=>{
    const pending=deferred();
    const reading=select('cancelled.json',()=>pending.promise);
    get('clear-baseline').onclick();
    pending.resolve(bad); await reading;
    assert.equal(get('comparison-panel').hidden,true);
    await get('run').onclick();
    assert.equal(get('comparison-panel').hidden,true);
  });

  await t.test('an obsolete read error cannot overwrite a newer success',async()=>{
    const pending=deferred();
    const earlier=select('unreadable.json',()=>pending.promise);
    await select('latest.json',async()=>good);
    const notice=get('notice').textContent;
    pending.reject(new Error('obsolete read failure')); await earlier;
    assert.match(heading(),/^latest.json/);
    assert.equal(get('notice').textContent,notice);
  });

  await t.test('rejecting an oversized replacement also invalidates the older read',async()=>{
    const pending=deferred();
    const earlier=select('slow.json',()=>pending.promise);
    await select('large.json',()=>assert.fail('oversized file must not be read'),1048577);
    pending.resolve(bad); await earlier;
    assert.equal(get('comparison-panel').hidden,true);
    assert.match(get('notice').textContent,/基线文件超过/);
    await get('run').onclick();
    assert.equal(get('comparison-panel').hidden,true);
  });

  await t.test('input edits suppress both obsolete success and obsolete errors',async()=>{
    for (const outcome of ['success','error']) {
      const pending=deferred();
      const reading=select('old-input.json',()=>pending.promise);
      get('input').oninput();
      const notice=get('notice').textContent;
      if (outcome==='success') pending.resolve(good);
      else pending.reject(new Error('belongs to old input'));
      await reading;
      assert.equal(get('notice').textContent,notice);
      assert.equal(get('comparison-panel').hidden,true);
    }
  });
  await t.test('current failures remain visible and a later successful read clears them',async()=>{
    await get('run').onclick();
    await select('broken.json',async()=>{throw new Error('current read failure');});
    assert.match(get('notice').textContent,/基线读取失败：current read failure/);
    assert.equal(get('comparison-panel').hidden,true);
    await select('recovered.json',async()=>good);
    assert.match(heading(),/^recovered.json/);
    assert.equal(get('notice').textContent,'');
    get('baseline').files=[]; await get('baseline').onchange();
    assert.equal(get('comparison-panel').hidden,true);
    await get('run').onclick(); assert.equal(get('comparison-panel').hidden,true);
  });

});
