exports.install=async function(page,options={}){
  await page.addInitScript(options=>{
    window.testTracks=[];window.reads=0;window.boxes=[];
    const get=CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData=function(...args){window.reads++;return get.apply(this,args);};
    const rect=CanvasRenderingContext2D.prototype.strokeRect;
    CanvasRenderingContext2D.prototype.strokeRect=function(...args){if(this.canvas.id==='overlay')window.boxes.push({color:this.strokeStyle,args});if(window.boxes.length>100)window.boxes.shift();return rect.apply(this,args);};
    window.runDrop=(mode='success',rgb='#eeeeee')=>{window.drop={start:performance.now(),mode,rgb};};
    window.clearDrop=()=>{window.drop=null;};
    if(options.fallback)HTMLVideoElement.prototype.requestVideoFrameCallback=undefined;
    navigator.mediaDevices.getUserMedia=async constraints=>{
      window.cameraConstraints=constraints;
      if(options.error)throw new DOMException('test',options.error);
      if(options.delayed)await new Promise(resolve=>window.resolveCamera=resolve);
      const c=document.createElement('canvas');window.sourceCanvas=c;c.width=options.portrait?480:640;c.height=options.portrait?640:480;
      const cx=c.getContext('2d');
      const draw=()=>{
        cx.fillStyle=window.lighting||'#202020';cx.fillRect(0,0,c.width,c.height);
        if(window.ambientMotion){cx.fillStyle='#aaaaaa';cx.fillRect((.5+.3*Math.sin(performance.now()/50))*c.width,.6*c.height,40,40);}
        if(window.drop){const age=(performance.now()-drop.start)/1000;
          let y=-.04+age*.5;
          if(drop.mode==='below')y=.4+age*.5;
          if(drop.mode==='reverse')y=.10-age*.2;
          if(drop.mode==='loss'&&y>.42)return;
          cx.fillStyle=drop.rgb;cx.fillRect(c.width*.45-10,y*c.height-10,20,20);
          if(drop.mode==='multiple'&&y>.3)cx.fillRect(c.width*.75,y*c.height,20,20);
        }
      };
      draw();const media=c.captureStream(30),track=media.getVideoTracks()[0];testTracks.push(track);
      const id=setInterval(()=>{if(track.readyState==='ended')clearInterval(id);else draw();},25);
      return media;
    };
  },options);
};
exports.prepare=async function(page){
  await page.locator('#startCamera').click();await page.waitForFunction(()=>document.getElementById('cameraState').textContent.includes('LIVE'));
  await page.locator('#captureBackground').click();await page.waitForFunction(()=>document.getElementById('state').textContent==='待機中',{}, {timeout:10000});
};
