const assert=require('node:assert/strict');const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const {install,prepare}=require('./motion-fixture.cjs');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});try{
 const page=await browser.newPage({viewport:{width:1024,height:900}});await page.route('https://script.google.com/**',r=>r.abort());await install(page);await page.goto(process.env.TEST_URL||'http://localhost:8765/');await prepare(page);
 // Entire-image foreground/large components must not veto either band.
 await page.evaluate(()=>{window.bandPulse='upper';});await page.waitForFunction(()=>document.getElementById('state').textContent==='計測中');
 await page.evaluate(()=>{window.hand=true;window.bandPulse=null;});await page.waitForFunction(()=>JSON.parse(localStorage.getItem('copter.records')||'[]').length===1);const r=await page.evaluate(()=>JSON.parse(localStorage.getItem('copter.records'))[0]);assert.equal(r.method,'background-bands-v1');assert.ok(r.seconds>0);
 await page.screenshot({path:'/private/tmp/copter-bands.png',fullPage:true});await page.locator('#debugToggle').check();assert.ok(await page.locator('#diagnostics').isVisible());
 console.log('PASS: upper-band then large hand (>16% foreground) in lower band records a time regardless of area/component exclusions');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
