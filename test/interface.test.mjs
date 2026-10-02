import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
class Node {
 constructor(tag='div'){this.tag=tag;this.children=[];this.value='';this.textContent='';this.style={};this.className='';this.attributes={};this.files=[];this.classList={toggle:()=>{}};}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=children;}
 setAttribute(name,value){this.attributes[name]=value;}
 scrollIntoView(){}
 click(){this.clicked=true;}
}
test('interface renders engine evidence, navigates tokens and clears stale results',async t=>{
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);};
 get('preset').value='role-leak';get('filter').value='all';
 const oldDocument=globalThis.document,oldFetch=globalThis.fetch;
 t.after(()=>{globalThis.document=oldDocument;globalThis.fetch=oldFetch;});
 globalThis.document={getElementById:get,createElement:tag=>new Node(tag)};
 globalThis.fetch=async path=>({ok:true,json:async()=>JSON.parse(await readFile(new URL('../web/'+path,import.meta.url),'utf8'))});
 await import('../web/app.js');
 assert.equal(get('metrics').children[0].children[1].textContent,'发现错误');
 assert.equal(get('tokens').children.length,7);
 assert.ok(get('findings').children.length>0);
 get('tokens').children[1].onclick();assert.match(get('detail').textContent,/位置 #1/);
 get('preset').value='healthy';await get('preset').onchange();
 assert.equal(get('metrics').children[0].children[1].textContent,'通过');
 get('input').value='{';get('run').onclick();
 assert.match(get('notice').textContent,/无法审计/);assert.equal(get('tokens').children.length,0);assert.equal(get('findings').children.length,0);
 get('export').onclick();assert.match(get('notice').textContent,/请先成功运行审计/);
});
