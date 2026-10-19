import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../access-counter.js',import.meta.url),'utf8');
// Independent fixed reference from the existing chopsticks-game and stat-golf apps.
const endpoint='https://script.google.com/macros/s/AKfycbxssCIHsD-N97SHxNC_GN0ihYeC0qy-lb-EY0KmSs6Gnztaph1sITMerLVEnNWOGkYc/exec';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function run(fetch){const context=vm.createContext({window:{},fetch});vm.runInContext(source,context);return context;}
test('shared endpoint receives only app, GET, keepalive and the established options',()=>{
  const calls=[];run((...args)=>{calls.push(args);return Promise.resolve({});});
  assert.equal(calls.length,1);const [url,options]=calls[0],parsed=new URL(url);
  assert.equal(parsed.origin+parsed.pathname,endpoint);assert.deepEqual([...parsed.searchParams],[['app','paper-copter-lab']]);
  assert.deepEqual(JSON.parse(JSON.stringify(options)),{method:'GET',mode:'no-cors',cache:'no-store',credentials:'omit',keepalive:true});
});
test('duplicate script evaluation never resends; a new document can send once',()=>{
  let count=0;const fetch=()=>{count++;return Promise.resolve({});};const context=run(fetch);
  vm.runInContext(source,context);vm.runInContext(source,context);assert.equal(count,1);run(fetch);assert.equal(count,2);
});
for(const mode of ['reject','throw','missing','pending'])test(`${mode}: silent failure or pending request does not interrupt startup or retry`,async()=>{
  let count=0;const fetch=mode==='missing'?undefined:()=>{count++;if(mode==='throw')throw Error('blocked');if(mode==='reject')return Promise.reject(Error('offline'));return new Promise(()=>{});};
  const context=run(fetch);vm.runInContext('window.appReady=true',context);vm.runInContext(source,context);await tick();
  assert.equal(context.window.appReady,true);assert.equal(count,mode==='missing'?0:1);
});
test('response body is never inspected',async()=>{
  const reads=[];run(()=>Promise.resolve({get text(){reads.push('text');},get json(){reads.push('json');},get status(){reads.push('status');}}));await tick();assert.deepEqual(reads,[]);
});
test('one independent defer script and no camera or timing event connection',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');assert.equal((html.match(/src="access-counter\.js"/g)||[]).length,1);assert.match(html,/<script defer src="access-counter\.js"><\/script>/);
  for(const file of ['app.js','tracker.js','camera-utils.js'])assert.doesNotMatch(readFileSync(new URL('../'+file,import.meta.url),'utf8'),/script\.google\.com|paperCopterAccessRecorded|\bfetch\s*\(/);
  assert.doesNotMatch(source,/\bawait\b|addEventListener|setTimeout|setInterval|document\.|console\./);
});
