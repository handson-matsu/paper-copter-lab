const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const endpoint = 'https://script.google.com/macros/s/AKfycbxssCIHsD-N97SHxNC_GN0ihYeC0qy-lb-EY0KmSs6Gnztaph1sITMerLVEnNWOGkYc/exec?app=paper-copter-lab';
const expectedOptions = { method:'GET', mode:'no-cors', cache:'no-store', credentials:'omit', keepalive:true };
(async () => {
  const browser = await chromium.launch({headless:true, executablePath:process.env.CHROME_PATH || undefined});
  try {
    for (const outcome of ['success','network-failure','sync-failure','missing-fetch','pending']) {
      const page = await browser.newPage();
      const errors = [], requests = [];
      page.on('pageerror', error => errors.push(error.message));
      // Every GAS request is intercepted. Never contact the real counter in tests.
      await page.route('https://script.google.com/**', async route => {
        requests.push({url:route.request().url(), method:route.request().method()});
        if(outcome === 'network-failure') await route.abort('failed');
        else await route.fulfill({status:200, body:'OK'});
      });
      await page.addInitScript(outcome => {
        window.counterCalls = [];
        const original = window.fetch;
        if(outcome === 'missing-fetch') window.fetch = undefined;
        else window.fetch = function(url, options) {
          if(String(url).startsWith('https://script.google.com/')) {
            window.counterCalls.push({url:String(url), options});
            if(outcome === 'sync-failure') throw Error('test counter failure');
            if(outcome === 'pending') return new Promise(() => {});
          }
          return original.call(this, url, options);
        };
        navigator.mediaDevices.getUserMedia = async () => {
          const c = document.createElement('canvas'); c.width=640; c.height=480;
          const cx=c.getContext('2d'), start=performance.now();
          const draw=()=>{
            const elapsed=performance.now()-start;
            const y=elapsed<800 ? .2 : Math.min(.8,.2+(elapsed-800)*.0006);
            cx.fillStyle='#222';cx.fillRect(0,0,640,480);
            cx.fillStyle='#ef2020';cx.fillRect(310,y*480-6,20,12);
          };
          draw();const media=c.captureStream(30), track=media.getVideoTracks()[0];
          const interval=setInterval(()=>{if(track.readyState==='ended')clearInterval(interval);else draw();},33);
          return media;
        };
      }, outcome);
      await page.goto(process.env.TEST_URL || 'http://127.0.0.1:8765/');
      const checkCalls = async () => assert.deepEqual(await page.evaluate(()=>window.counterCalls), outcome === 'missing-fetch' ? [] : [{url:endpoint, options:expectedOptions}]);
      await checkCalls();
      const before = await page.locator('#message').textContent();
      await page.addScriptTag({url:new URL('access-counter.js',page.url()).href});
      await checkCalls(); // Duplicate evaluation also cannot resend.
      await page.getByRole('button',{name:'02 条件設定'}).click();
      await page.locator('[name=experiment]').fill('カウンター検証');
      await page.getByRole('button',{name:'01 計測'}).click();
      assert.equal(await page.locator('#message').textContent(),before);
      await page.locator('#startCamera').click();
      await page.waitForFunction(()=>JSON.parse(localStorage.getItem('copter.records')||'[]').length===1, {}, {timeout:12000});
      await page.locator('#next').click();
      await page.locator('#stopCamera').click();
      await page.getByRole('button',{name:'03 測定結果'}).click();
      await page.getByRole('button',{name:'確認して確定'}).click();
      const download=page.waitForEvent('download'); await page.locator('#export').click(); await download;
      await checkCalls();
      assert.equal(await page.locator('#storageMessage').textContent(),'');
      assert.equal(await page.locator('#resultNotice').textContent(),'');
      const networkCount=['success','network-failure'].includes(outcome) ? 1 : 0;
      assert.equal(requests.length,networkCount);
      await page.reload();await checkCalls();
      await page.waitForTimeout(100);
      assert.equal(requests.length,networkCount*2);
      assert.ok(requests.every(r=>r.url===endpoint && r.method==='GET'));
      assert.equal(await page.locator('[name=experiment]').inputValue(),'カウンター検証');
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('copter.records')).length),1);
      assert.deepEqual(errors,[]);
      await page.close();
      console.log(`PASS: ${outcome}: once per document, no retries or operation sends, measurement/storage/CSV work, reload sends once again`);
    }
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exit(1);});
