const assert=require('node:assert/strict');const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const {install,prepare}=require('./motion-fixture.cjs');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});try{
 const page=await browser.newPage({viewport:{width:1024,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://script.google.com/**',r=>r.abort());await install(page);await page.goto(process.env.TEST_URL||'http://localhost:8765/');
 await page.getByRole('button',{name:'02 条件設定'}).click();await page.locator('[name=experiment]').fill('簡易帯通過');await page.reload();assert.equal(await page.locator('[name=experiment]').inputValue(),'簡易帯通過');await prepare(page);
 let expected=0;
 for(const duration of [.2,.5,.8]){
  await page.evaluate(duration=>runDrop('success','#eeeeee',duration),duration);expected++;
  await page.waitForFunction(n=>JSON.parse(localStorage.getItem('copter.records')||'[]').length===n,expected,{timeout:7000});
  const r=await page.evaluate(()=>JSON.parse(localStorage.getItem('copter.records'))[0]);assert.equal(r.method,'background-bands-v1');assert.ok(Math.abs(r.seconds-duration)<.12,JSON.stringify(r));assert.equal(r.milliseconds,r.end-r.start);assert.equal(r.conditions.experiment,'簡易帯通過');
  assert.match(await page.locator('#upperStatus').textContent(),/検出/);assert.match(await page.locator('#lowerStatus').textContent(),/検出/);await page.evaluate(()=>clearDrop());await page.waitForTimeout(650);
 }
 // Direct band pulse in successive frames demonstrates sub-100ms storage.
 await page.evaluate(()=>window.bandPulse='upper');await page.waitForFunction(()=>document.getElementById('state').textContent==='計測中');await page.evaluate(()=>window.bandPulse='lower');expected++;
 await page.waitForFunction(n=>JSON.parse(localStorage.getItem('copter.records')).length===n,expected);let r=await page.evaluate(()=>JSON.parse(localStorage.getItem('copter.records'))[0]);assert.ok(r.seconds>0&&r.seconds<.1,JSON.stringify(r));await page.evaluate(()=>window.bandPulse=null);await page.waitForTimeout(650);
 // No lower hit: a reason is shown and no synthetic result is stored.
 await page.evaluate(()=>window.bandPulse='upper');await page.waitForFunction(()=>document.getElementById('state').textContent==='計測中');await page.evaluate(()=>window.bandPulse=null);await page.waitForFunction(()=>document.getElementById('state').textContent==='測定失敗',{}, {timeout:6500});assert.match(await page.locator('#resultNotice').textContent(),/下側/);assert.equal(await page.locator('#time').textContent(),'—');assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('copter.records')).length),expected);
 await page.locator('#stopCamera').click();await page.reload();await page.getByRole('button',{name:'03 測定結果'}).click();assert.equal(await page.locator('#history tr').count(),expected);
 const download=page.waitForEvent('download');await page.locator('#export').click();let csv='';for await(const chunk of await (await download).createReadStream())csv+=chunk.toString();assert.ok(csv.includes('background-bands-v1'));assert.ok(csv.includes('時間(ms)'));
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'削除',exact:true}).first().click();assert.equal(await page.locator('#history tr').count(),expected-1);
 await page.evaluate(()=>localStorage.setItem('copter.records',JSON.stringify([{id:'legacy',date:new Date().toISOString(),seconds:1.234,conditions:{experiment:'旧データ'},flags:[],status:'確認待ち'}])));await page.reload();await page.getByRole('button',{name:'03 測定結果'}).click();assert.match(await page.locator('#history').textContent(),/旧方式/);await page.getByRole('button',{name:'確認して確定'}).click();
 await page.getByRole('button',{name:'01 計測'}).click();for(const [width,height]of [[1024,768],[768,1024],[390,844]]){await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}await page.locator('#debugToggle').check();assert.ok(await page.locator('#diagnostics').isVisible());assert.deepEqual(errors,[]);
 console.log('PASS: 0.2/0.5/0.8s band passage, sub-0.1s pulse, flash/status, automatic repeats, missing lower timeout, conditions/reload/history/CSV/delete/legacy/responsive');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
