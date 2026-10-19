// Background and tracking buffers contain only reduced-resolution local pixels.
export class MotionDetector {
  constructor(){this.reset();}
  reset(){this.ready=false;this.started=null;this.samples=0;this.width=0;this.height=0;this.lastAdapt=null;this.captureFrames=null;}
  allocate(w,h){
    if(this.width===w&&this.height===h)return;
    this.reset();this.width=w;this.height=h;const n=w*h;
    this.background=new Float32Array(n*3);this.captureFrames=new Uint8Array(n*3*15);this.difference=new Uint8Array(n);
    this.mask=new Uint8Array(n);this.clean=new Uint8Array(n);this.seen=new Uint8Array(n);this.queue=new Uint32Array(n);
    this.hist=new Uint32Array(511*3);
  }
  process(data,w,h,t,sensitivity=50,adapt=false){
    this.allocate(w,h);const n=w*h,threshold=50-sensitivity*.28;
    if(!this.ready){
      if(this.started===null)this.started=t;
      if(this.samples<15 && t-this.started>=this.samples*100){
        const offset=this.samples*n*3;
        for(let p=0;p<n;p++)for(let c=0;c<3;c++)this.captureFrames[offset+p*3+c]=data[p*4+c];
        this.samples++;
      }
      if(t-this.started>=1500 && this.samples>=3){
        const scratch=new Uint8Array(this.samples);
        for(let i=0;i<n*3;i++){
          for(let k=0;k<this.samples;k++){
            const value=this.captureFrames[k*n*3+i];let j=k;
            while(j>0&&scratch[j-1]>value){scratch[j]=scratch[j-1];j--;}
            scratch[j]=value;
          }
          this.background[i]=this.samples%2?scratch[Math.floor(this.samples/2)]:(scratch[this.samples/2-1]+scratch[this.samples/2])/2;
        }
        this.ready=true;this.captureFrames=null;this.lastAdapt=t;
      }
      return {ready:this.ready,blobs:[],motion:false,progress:Math.min(1,(t-this.started)/1500),reason:this.ready?`背景取得完了（${this.samples}フレーム中央値）`:'背景取得中：多少の動きがあっても約1.5秒で完了します'};
    }
    // Sampled channel-wise median compensates a global illumination shift.
    this.hist.fill(0);let count=0;
    for(let p=0;p<n;p+=8){for(let c=0;c<3;c++){const d=Math.round(data[p*4+c]-this.background[p*3+c]);this.hist[c*511+d+255]++;}count++;}
    const offsets=[];
    for(let c=0;c<3;c++){let sum=0;for(let i=0;i<511;i++){sum+=this.hist[c*511+i];if(sum>=count/2){offsets[c]=i-255;break;}}}
    this.mask.fill(0);this.clean.fill(0);this.seen.fill(0);
    let changed=0,maxDifference=0,rawMaxDifference=0;
    for(let p=0;p<n;p++){
      let diff=0;for(let c=0;c<3;c++){const raw=data[p*4+c]-this.background[p*3+c];rawMaxDifference=Math.max(rawMaxDifference,Math.abs(raw));diff=Math.max(diff,Math.abs(raw-offsets[c]));}
      maxDifference=Math.max(maxDifference,diff);
      this.difference[p]=Math.min(255,diff);
      if(diff>threshold){this.mask[p]=1;changed++;}
    }
    const dt=this.lastAdapt===null?0:Math.max(0,Math.min(200,t-this.lastAdapt));this.lastAdapt=t;
    // Freeze during tracking/cooldown. Never learn foreground pixels into the model.
    if(adapt && changed/n<=.16 && offsets.every(v=>Math.abs(v)<=80)){
      const alpha=1-Math.exp(-dt/15000);
      for(let p=0;p<n;p++)if(!this.mask[p])for(let c=0;c<3;c++){
        const i=p*3+c;this.background[i]+=alpha*(data[p*4+c]-this.background[i]);
      }
    }
    const widespread=changed/n>.16 || offsets.some(v=>Math.abs(v)>80);
    // A measurement rejection must not hide the detected foreground on screen.
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const p=y*w+x;if(this.mask[p]&&(this.mask[p-1]+this.mask[p+1]+this.mask[p-w]+this.mask[p+w]>=2))this.clean[p]=1;}
    const blobs=[],regions=[];let motionPixels=0,components=0,smallRejected=0,largeRejected=0;
    for(let p=0;p<n;p++){
      if(!this.clean[p]||this.seen[p])continue;
      this.queue[0]=p;this.seen[p]=1;let length=1,sx=0,sy=0,x0=w,y0=h,x1=0,y1=0;
      for(let q=0;q<length;q++){
        const i=this.queue[q],x=i%w,y=Math.floor(i/w);sx+=x;sy+=y;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
        if(x>0&&this.clean[i-1]&&!this.seen[i-1]){this.seen[i-1]=1;this.queue[length++]=i-1;}
        if(x<w-1&&this.clean[i+1]&&!this.seen[i+1]){this.seen[i+1]=1;this.queue[length++]=i+1;}
        if(y>0&&this.clean[i-w]&&!this.seen[i-w]){this.seen[i-w]=1;this.queue[length++]=i-w;}
        if(y<h-1&&this.clean[i+w]&&!this.seen[i+w]){this.seen[i+w]=1;this.queue[length++]=i+w;}
      }
      components++;
      const region={x:sx/length/w,y:sy/length/h,area:length,x0:x0/w,y0:y0/h,x1:(x1+1)/w,y1:(y1+1)/h};
      if(length>=3)regions.push(region);
      if(length<Math.max(9,n*.00015)){smallRejected++;continue;}
      motionPixels+=length;
      if(length>=n*.08){largeRejected++;continue;}
      blobs.push(region);
    }
    const invalid=widespread || (motionPixels>0&&!blobs.length);
    const reason=widespread?'広範囲の動体反応／照明変化：計測対象から除外':largeRejected?'大きな動体反応：計測対象から除外':smallRejected&&!blobs.length?'小さい動体反応：計測面積条件未満':'';
    return {ready:true,blobs,regions,motion:motionPixels>0||widespread,invalid,reason,
      stats:{threshold,rawMaxDifference,maxDifference,changedPixels:changed,changedRatio:changed/n,components,smallRejected,largeRejected,offsets,backgroundUpdating:adapt&&changed/n<=.16&&offsets.every(v=>Math.abs(v)<=80)}};
  }
}
// Bands read the raw threshold mask, before component/area/shape filtering.
export function bandActivity(mask,width,height,config={}){
  const {upper=.25,lower=.75,bandHeight=.12,minPixels=3}=config;
  const read=center=>{
    const top=Math.max(0,Math.floor((center-bandHeight/2)*height));
    const bottom=Math.min(height,Math.ceil((center+bandHeight/2)*height));let pixels=0;
    for(let y=top;y<bottom;y++)for(let x=0;x<width;x++)pixels+=mask[y*width+x]?1:0;
    return {active:pixels>=minPixels,pixels,top:top/height,bottom:bottom/height};
  };
  return {upper:read(upper),lower:read(lower)};
}
export class BandTimer {
  constructor(config={}){this.config={upper:.25,lower:.75,bandHeight:.12,minPixels:3,cooldownMs:600,maxMs:5000,...config};this.reset();}
  reset(){this.state='背景取得待ち';this.start=null;this.end=null;this.reason='';this.locked=false;this.until=0;this.lastTime=-Infinity;this.result=null;this.upperHitAt=null;this.lowerHitAt=null;}
  fail(reason,t=this.lastTime){this.reason=reason;this.state='測定失敗';this.locked=true;this.until=t+this.config.cooldownMs;return {type:'failure',reason};}
  update(d,t){
    if(!Number.isFinite(t)||t<=this.lastTime)return null;this.lastTime=t;
    if(!d.ready){this.state='背景取得中';return null;}
    if(this.locked){if(t<this.until)return null;this.locked=false;this.start=null;this.end=null;this.result=null;this.reason='';this.state='待機中';}
    const upper=!!d.bands?.upper.active,lower=!!d.bands?.lower.active;
    if(this.start===null){
      this.state='待機中';
      if(!upper){this.reason=lower?'下側のみ反応：上側の反応待ち':'上側判定帯の反応待ち';return null;}
      this.start=t;this.upperHitAt=t;this.lowerHitAt=null;this.state='計測中';this.reason=lower?'両帯が同じフレームで反応：次のフレームの下側反応待ち':'上側検出：下側判定帯の反応待ち';
      return {type:'start',start:t};
    }
    if(t-this.start>this.config.maxMs)return this.fail('上側検出後5秒以内に下側判定帯を検出できませんでした',t);
    if(lower){
      this.end=t;this.lowerHitAt=t;this.state='計測完了';this.locked=true;this.until=t+this.config.cooldownMs;this.reason='上下検出完了：600ms後に自動受付';
      this.result={type:'success',seconds:(this.end-this.start)/1000,milliseconds:this.end-this.start,start:this.start,end:this.end,flags:['簡易帯検出：同一物体・方向は未確認'],status:'簡易計測',method:'background-bands-v1'};
      return this.result;
    }
    this.state='計測中';this.reason='下側判定帯の反応待ち';return null;
  }
}
export function csvCell(value){return '"'+String(value??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';}
