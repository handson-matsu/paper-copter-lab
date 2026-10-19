const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const url=process.env.TEST_URL||'http://127.0.0.1:8765/paper-copter-lab/';
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
  const errors=[];
  async function open(config={}){
    const page=await browser.newPage({viewport:{width:1024,height:768},deviceScaleFactor:3});
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(config=>{
      window.reads=0;window.arcInfo=null;window.testTracks=[];
      if(config.insecure)Object.defineProperty(window,'isSecureContext',{value:false});
      if(config.missingAPI)Object.defineProperty(navigator,'mediaDevices',{value:undefined});
      const get=CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData=function(...args){window.reads++;return get.apply(this,args);};
      const arc=CanvasRenderingContext2D.prototype.arc;
      CanvasRenderingContext2D.prototype.arc=function(...args){if(this.canvas.id==='overlay')window.arcInfo={x:args[0],y:args[1],width:this.canvas.width,height:this.canvas.height};return arc.apply(this,args);};
      if(config.fallback)HTMLVideoElement.prototype.requestVideoFrameCallback=undefined;
      if(config.playError)HTMLMediaElement.prototype.play=async()=>{throw new DOMException('test','NotAllowedError');};
      if(!config.missingAPI)navigator.mediaDevices.getUserMedia=async constraints=>{
        window.cameraConstraints=constraints;
        if(config.error)throw new DOMException('test',config.error);
        if(config.delayed)await new Promise(resolve=>window.resolveCamera=resolve);
        const c=document.createElement('canvas');window.sourceCanvas=c;c.width=config.portrait?480:640;c.height=config.portrait?640:480;
        const cx=c.getContext('2d');const draw=()=>{cx.fillStyle='#222';cx.fillRect(0,0,c.width,c.height);cx.fillStyle='#ed2020';cx.fillRect(c.width*.25-8,c.height*.4-8,16,16);};
        draw();const media=c.captureStream(60);const track=media.getVideoTracks()[0];window.testTracks.push(track);
        const id=setInterval(()=>{if(track.readyState==='ended')clearInterval(id);else draw();},16);
        return media;
      };
    },config);
    await page.route('https://script.google.com/**',route=>route.abort('failed'));
    const response=await page.goto(url);assert.equal(response.status(),200);return page;
  }
  async function start(page){await page.evaluate(()=>window.arcInfo=null);await page.locator('#startCamera').click();await page.waitForFunction(()=>window.arcInfo!==null);}
  async function aligned(page){
    // Wait for a draw at the current backing size, rather than a fixed sleep.
    await page.waitForFunction(()=>{const c=document.getElementById('overlay');return window.arcInfo?.width===c.width && window.arcInfo?.height===c.height;});
    const info=await page.evaluate(()=>{const v=document.getElementById('video'),c=document.getElementById('overlay');return {sw:v.videoWidth,sh:v.videoHeight,w:c.width,h:c.height,arc:window.arcInfo};});
    const scale=Math.min(info.w/info.sw,info.h/info.sh),x=(info.w-info.sw*scale)/2+.25*info.sw*scale,y=(info.h-info.sh*scale)/2+.4*info.sh*scale;
    assert.ok(Math.abs(info.arc.x-x)<8 && Math.abs(info.arc.y-y)<8,JSON.stringify(info));
    assert.ok(Math.max(info.w,info.h)<=1920);
  }
  for(const portrait of [false,true]){
    const page=await open({portrait});await start(page);await aligned(page);
    assert.deepEqual(await page.evaluate(()=>({muted:video.muted,inline:video.playsInline,audio:cameraConstraints.audio,facing:cameraConstraints.video.facingMode.ideal})),{muted:true,inline:true,audio:false,facing:'environment'});
    for(const [width,height] of [[768,1024],[390,844]]){await page.setViewportSize({width,height});await page.waitForTimeout(150);await aligned(page);}
    await page.getByRole('button',{name:'02 条件設定'}).click();await page.waitForTimeout(200);await page.getByRole('button',{name:'01 計測'}).click();await page.waitForTimeout(100);await aligned(page);
    await page.setViewportSize({width:1024,height:768});await page.waitForTimeout(150);
    await page.locator('#setFloor').click();const box=await page.locator('#overlay').boundingBox();
    // Portrait source has horizontal margins inside the landscape stage.
    if(portrait){await page.mouse.click(box.x+5,box.y+box.height*.5);assert.match(await page.locator('#message').textContent(),/余白/);}
    await page.mouse.click(box.x+box.width*.5,box.y+box.height*.8);assert.match(await page.locator('#floorInfo').textContent(),/指定済み/);
    await page.locator('#stopCamera').click();assert.ok(await page.evaluate(()=>testTracks.every(t=>t.readyState==='ended')));
    const reads=await page.evaluate(()=>window.reads);await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>window.reads),reads);
    await start(page);assert.match(await page.locator('#floorInfo').textContent(),/指定し直し/);await aligned(page);
    await page.evaluate(()=>window.dispatchEvent(new Event('orientationchange')));assert.equal(await page.locator('#startCamera').isEnabled(),true);assert.ok(await page.evaluate(()=>testTracks.every(t=>t.readyState==='ended')));
    await start(page);await aligned(page);
    await page.evaluate(()=>{sourceCanvas.width=480;sourceCanvas.height=480;});await page.waitForFunction(()=>document.getElementById('message').textContent.includes('縦横サイズが変化'));assert.ok(await page.evaluate(()=>testTracks.every(t=>t.readyState==='ended')));
    await page.close();
  }
  for(const [config,text] of [[{insecure:true},'HTTPSが必要'],[{missingAPI:true},'カメラAPIを利用できません']]){const page=await open(config);await page.locator('#startCamera').click();assert.ok((await page.locator('#message').textContent()).includes(text));assert.equal(await page.locator('#startCamera').isEnabled(),true);await page.close();}
  for(const error of ['NotAllowedError','NotFoundError','NotReadableError','OverconstrainedError','SecurityError','AbortError','InvalidStateError','UnknownError']){
    const page=await open({error});await page.locator('#startCamera').click();await page.waitForFunction(name=>document.getElementById('message').textContent.includes(name),error);assert.equal(await page.locator('#startCamera').isEnabled(),true);await page.close();
  }
  {const page=await open({playError:true});await page.locator('#startCamera').click();await page.waitForFunction(()=>document.getElementById('message').textContent.includes('再生できません'));assert.ok(await page.evaluate(()=>testTracks.every(t=>t.readyState==='ended')));await page.close();}
  {const page=await open({delayed:true});await page.locator('#startCamera').click();await page.waitForFunction(()=>window.resolveCamera);await page.locator('#stopCamera').click();await page.evaluate(()=>resolveCamera());await page.waitForFunction(()=>testTracks.length===1&&testTracks[0].readyState==='ended');assert.equal(await page.locator('#startCamera').isEnabled(),true);await page.close();}
  {const page=await open({fallback:true});await start(page);await aligned(page);const before=await page.evaluate(()=>window.reads);await page.waitForTimeout(1000);const frames=await page.evaluate(()=>window.reads)-before;assert.ok(frames>5&&frames<=31,`rate ${frames}`);console.log(`fallback analysis frames / 1 second: ${frames}`);await page.close();}
  assert.deepEqual(errors,[]);await browser.close();
  console.log('PASS: Pages subpath, inline/muted/back-camera constraints, overlay alignment (2 source orientations, 3 viewport sizes, DPR3), floor margins, restart, rotation, source resize, cancellation, track/callback cleanup, 8 capture errors, playback error, fallback rate cap');
})().catch(error=>{console.error(error);process.exit(1);});
