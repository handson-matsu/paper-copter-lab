const assert=require('node:assert/strict');const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const {install,prepare}=require('./motion-fixture.cjs');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});try{
 for(const options of [{},{portrait:true},{fallback:true}]){
  const page=await browser.newPage({viewport:{width:1024,height:900},deviceScaleFactor:2}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://script.google.com/**',r=>r.abort());await install(page,options);await page.goto(process.env.TEST_URL||'http://localhost:8765/');await page.locator('#debugToggle').check();await prepare(page);
  const before=await page.locator('#debug').textContent();await page.evaluate(()=>{window.boxes=[];window.hand=true;});
  await page.waitForFunction(()=>document.getElementById('debug').textContent.includes('大面積除外=1'));
  const text=await page.locator('#debug').textContent();assert.match(text,/動体反応: 1 \/ 計測候補: 0/);assert.match(text,/広範囲/);assert.notEqual(text,before);
  await page.waitForFunction(()=>boxes.some(b=>b.color==='#69f2a3'));
  const box=await page.evaluate(()=>boxes.filter(b=>b.color==='#69f2a3').at(-1));
  // Verify object-fit contain mapping against the actual source dimensions.
  const geometry=await page.evaluate(()=>({sw:video.videoWidth,sh:video.videoHeight,w:overlay.width,h:overlay.height}));
  const scale=Math.min(geometry.w/geometry.sw,geometry.h/geometry.sh);
  const left=(geometry.w-geometry.sw*scale)/2,top=(geometry.h-geometry.sh*scale)/2;assert.ok(box.args[0]>=left+.09*geometry.sw*scale&&box.args[0]<=left+.21*geometry.sw*scale);assert.ok(Math.abs(box.args[1]-(top+.32*geometry.sh*scale))<12);
  assert.ok(Math.abs(box.args[2]-.45*geometry.sw*scale)<12);assert.ok(Math.abs(box.args[3]-.5*geometry.sh*scale)<12);
  await page.waitForTimeout(600);const later=await page.locator('#debug').textContent();assert.notEqual(later,text);assert.ok(Number(later.match(/入力変化: (\d+)/)[1])>0);
  assert.match(await page.locator('#detection').textContent(),/広範囲/);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('copter.records')||'[]').length),0);
  if(!options.portrait&&!options.fallback)await page.screenshot({path:'/private/tmp/copter-hand-reaction.png',fullPage:true});
  await page.evaluate(()=>window.hand=false);await page.waitForTimeout(100);await page.evaluate(()=>runDrop());await page.waitForFunction(()=>JSON.parse(localStorage.getItem('copter.records')||'[]').length===1,{}, {timeout:10000});
  assert.deepEqual(errors,[]);await page.close();console.log('PASS: '+JSON.stringify(options)+' Canvas input changes, nonzero difference, large hand visible, no false timing, contain coordinates, ordinary drop saved');
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
