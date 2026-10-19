exports.install=async function(page,options={}){
  await page.addInitScript(options=>{
    window.testTracks=[];window.reads=0;window.boxes=[];
    const get=CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData=function(...args){window.reads++;return get.apply(this,args);};
    const rect=CanvasRenderingContext2D.prototype.strokeRect;
    CanvasRenderingContext2D.prototype.strokeRect=function(...args){if(this.canvas.id==='overlay')window.boxes.push({color:this.strokeStyle,args});if(window.boxes.length>100)window.boxes.shift();return rect.apply(this,args);};
    window.runDrop=(mode='success',rgb='#eeeeee',duration=.5)=>{window.drop={start:performance.now(),mode,rgb,speed:.5/duration};};
    window.clearDrop=()=>{window.drop=null;};
    if(options.fallback)HTMLVideoElement.prototype.requestVideoFrameCallback=undefined;
    navigator.mediaDevices.getUserMedia=async constraints=>{
      window.cameraConstraints=constraints;
      if(options.error)throw new DOMException('test',options.error);
      if(options.delayed)await new Promise(resolve=>window.resolveCamera=resolve);
      const c=document.createElement('canvas');window.sourceCanvas=c;c.width=options.noise?320:options.portrait?480:640;c.height=options.noise?240:options.portrait?640:480;
      const cx=c.getContext('2d');let noiseFrame=0;const noiseImage=cx.createImageData(c.width,c.height);
      const draw=()=>{
        cx.fillStyle=window.lighting||'#202020';cx.fillRect(0,0,c.width,c.height);
        if(options.noise){noiseFrame++;const light=12*Math.sin(noiseFrame*.7);
          for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
            const jitter=((x*13+y*7+noiseFrame*11)%17)-8;
            const value=200+light+jitter+(x<60?12*Math.sin(noiseFrame*1.9+x):0),i=(y*c.width+x)*4;
            noiseImage.data[i]=noiseImage.data[i+1]=noiseImage.data[i+2]=value;noiseImage.data[i+3]=255;
          }cx.putImageData(noiseImage,0,0);
          if(window.gateFlash){cx.fillStyle='rgba(255,255,255,.85)';const center=noiseFrame%12<6?.25:.75;cx.fillRect(0,(center-.06)*c.height,c.width,.12*c.height);}
        }
        if(window.bandPulse){cx.fillStyle='#eeeeee';const center=window.bandPulse==='upper'?.25:.75;cx.fillRect(.4*c.width,(center-.025)*c.height,30,.05*c.height);}
        if(window.hand){cx.fillStyle='#b48c6e';cx.fillRect((.15+.05*Math.sin(performance.now()/1200))*c.width,.32*c.height,c.width*.45,c.height*.5);}
        if(window.ambientMotion){cx.fillStyle='#aaaaaa';cx.fillRect((.5+.3*Math.sin(performance.now()/50))*c.width,.6*c.height,40,40);}
        if(window.drop){const age=(performance.now()-drop.start)/1000;
          let y=-.04+age*(drop.speed||1);
          if(drop.mode==='below')y=.4+age*(drop.speed||1);
          if(drop.mode==='reverse')y=.10-age*.2;
          if(drop.mode==='loss'&&y>.42)return;
          cx.fillStyle=drop.rgb;const size=options.noise?6:20;cx.fillRect(c.width*.45-size/2,y*c.height-size/2,size,size);
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
