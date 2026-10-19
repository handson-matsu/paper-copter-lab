const assert=require('node:assert/strict');const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {install,prepare}=require('./motion-fixture.cjs');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});try{
 const page=await browser.newPage({viewport:{width:1024,height:768}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://script.google.com/**',r=>r.abort());await install(page);
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:8765/');
 await page.getByRole('button',{name:'02 条件設定'}).click();await page.locator('[name=experiment]').fill('動体通過実験');await page.reload();assert.equal(await page.locator('[name=experiment]').inputValue(),'動体通過実験');
 await prepare(page);
 // Touch-style pointer dragging uses the same transform as drawing (no letterbox here).
 const b=await page.locator('#overlay').boundingBox();await page.mouse.move(b.x+b.width*.5,b.y+b.height*.25);await page.mouse.down();await page.mouse.move(b.x+b.width*.5,b.y+b.height*.3);await page.mouse.up();assert.match(await page.locator('#lineInfo').textContent(),/上側30%/);
 await page.waitForFunction(()=>document.getElementById('state').textContent==='待機中');
 await page.evaluate(()=>runDrop());await page.waitForFunction(()=>JSON.parse(localStorage.getItem('copter.records')||'[]').length===1,{}, {timeout:10000}).catch(async e=>{console.error(await page.locator('#resultNotice').textContent());throw e;});
 let record=await page.evaluate(()=>JSON.parse(localStorage.getItem('copter.records'))[0]);assert.equal(record.method,'background-lines-v1');assert.ok(record.seconds>.75&&record.seconds<1.05,record.seconds);assert.equal(record.conditions.experiment,'動体通過実験');assert.equal(await page.locator('#state').textContent(),'計測完了');
 assert.ok(await page.evaluate(()=>boxes.some(b=>b.color==='#63b6ff')));
 await page.waitForFunction(()=>document.getElementById('state').textContent==='待機中',{}, {timeout:10000});
 await page.evaluate(()=>runDrop('loss'));await page.waitForFunction(()=>document.getElementById('state').textContent==='測定失敗',{}, {timeout:10000});assert.equal(await page.locator('#time').textContent(),'—');assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('copter.records')).length),1);
 await page.evaluate(()=>runDrop('success'));await page.waitForTimeout(2500);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('copter.records')).length),1);
 await page.evaluate(()=>clearDrop());await page.waitForFunction(()=>document.getElementById('state').textContent==='待機中');
 await page.evaluate(()=>runDrop('below'));await page.waitForTimeout(1500);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('copter.records')).length),1);
 await page.locator('#stopCamera').click();await page.reload();await page.getByRole('button',{name:'03 測定結果'}).click();assert.equal(await page.locator('#history tr').count(),1);
 const downloaded=page.waitForEvent('download');await page.locator('#export').click();const file=await downloaded;assert.ok(file.suggestedFilename().endsWith('.csv'));let csv='';for await(const chunk of await file.createReadStream())csv+=chunk.toString('utf8');assert.ok(csv.includes('background-lines-v1'));
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'削除',exact:true}).click();assert.equal(await page.locator('#history tr').count(),0);
 await page.evaluate(()=>localStorage.setItem('copter.records',JSON.stringify([{id:'legacy',date:new Date().toISOString(),seconds:1.234,conditions:{experiment:'旧データ'},flags:['旧記録の確認'],status:'確認待ち'}])));await page.reload();await page.getByRole('button',{name:'03 測定結果'}).click();assert.match(await page.locator('#history').textContent(),/旧方式の落下時間/);await page.getByRole('button',{name:'確認して確定'}).click();assert.match(await page.locator('#history').textContent(),/手動確認済み/);
 await page.getByRole('button',{name:'01 計測'}).click();for(const [width,height]of [[1024,768],[768,1024],[390,844]]){await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await page.locator('#debugToggle').check();assert.ok(await page.locator('#debug').isVisible());await page.screenshot({path:'/private/tmp/copter-motion.png',fullPage:true});assert.deepEqual(errors,[]);
 console.log('PASS: background capture, draggable lines, white-object passage, cooldown, loss/no replacement/no false numbers, below-line rejection, conditions/history/reload/CSV/delete, legacy records, responsive UI');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
