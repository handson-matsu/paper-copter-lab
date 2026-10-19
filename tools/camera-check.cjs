const assert=require('node:assert/strict');const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const {install,prepare}=require('./motion-fixture.cjs');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});try{
for(const options of [{},{portrait:true},{fallback:true}]){
 const page=await browser.newPage({viewport:{width:1024,height:768},deviceScaleFactor:3}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://script.google.com/**',r=>r.abort());await install(page,options);await page.goto(process.env.TEST_URL||'http://127.0.0.1:8765/');await prepare(page);
 assert.ok(await page.evaluate(()=>video.muted&&video.playsInline&&cameraConstraints.audio===false&&cameraConstraints.video.facingMode.ideal==='environment'));
 await page.evaluate(()=>runDrop('success','#20d060'));await page.waitForFunction(()=>document.getElementById('state').textContent==='計測中');if(!options.portrait&&!options.fallback)await page.screenshot({path:'/private/tmp/copter-motion-active.png',fullPage:true});
 await page.evaluate(()=>window.dispatchEvent(new Event('orientationchange')));assert.equal(await page.locator('#startCamera').isEnabled(),true);assert.equal(await page.locator('#time').textContent(),'—');assert.equal(await page.evaluate(()=>testTracks.every(t=>t.readyState==='ended')),true);
 const reads=await page.evaluate(()=>window.reads);await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>window.reads),reads);
 await page.evaluate(()=>clearDrop());await prepare(page);assert.equal(await page.locator('#state').textContent(),'待機中');
 await page.evaluate(()=>{sourceCanvas.width=500;sourceCanvas.height=500;});await page.waitForFunction(()=>document.getElementById('message').textContent.includes('縦横サイズ'));assert.ok(await page.evaluate(()=>testTracks.every(t=>t.readyState==='ended')));assert.deepEqual(errors,[]);await page.close();
}
for(const error of ['NotAllowedError','NotFoundError','NotReadableError','OverconstrainedError','SecurityError','AbortError','InvalidStateError']){
 const page=await browser.newPage();await page.route('https://script.google.com/**',r=>r.abort());await install(page,{error});await page.goto(process.env.TEST_URL||'http://127.0.0.1:8765/');await page.locator('#startCamera').click();await page.waitForFunction(name=>document.getElementById('message').textContent.includes(name),error);assert.ok(await page.locator('#startCamera').isEnabled());await page.close();
}
console.log('PASS: landscape/portrait/fallback capture, rotation interruption without saved values, track cleanup, restart/background reacquisition, source resize, 7 camera errors');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
