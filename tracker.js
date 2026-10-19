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
    let changed=0;
    for(let p=0;p<n;p++){
      let diff=0;for(let c=0;c<3;c++)diff=Math.max(diff,Math.abs(data[p*4+c]-this.background[p*3+c]-offsets[c]));
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
    if(changed/n>.16 || offsets.some(v=>Math.abs(v)>80))return {ready:true,blobs:[],motion:true,invalid:true,reason:'照明変化／カメラ移動が大きすぎます。背景を再取得してください'};
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const p=y*w+x;if(this.mask[p]&&(this.mask[p-1]+this.mask[p+1]+this.mask[p-w]+this.mask[p+w]>=2))this.clean[p]=1;}
    const blobs=[];let motionPixels=0;
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
      if(length>=Math.max(9,n*.00015)){
        motionPixels+=length;
        if(length<n*.08)blobs.push({x:sx/length/w,y:sy/length/h,area:length,x0:x0/w,y0:y0/h,x1:(x1+1)/w,y1:(y1+1)/h});
      }
    }
    return {ready:true,blobs,motion:motionPixels>0,invalid:motionPixels>0&&!blobs.length,reason:motionPixels&&!blobs.length?'物体が大きすぎます':''};
  }
}
export class PassageTracker {
  constructor(config={}){this.config={upper:.25,lower:.75,quietMs:800,maxMs:10000,maxGap:180,...config};this.reset();}
  reset(){this.state='背景取得待ち';this.track=null;this.start=null;this.end=null;this.reason='';this.quiet=null;this.locked=false;this.armed=false;this.result=null;this.speed=0;}
  fail(reason){if(this.locked)return null;this.reason=reason;this.state='測定失敗';this.locked=true;this.armed=false;this.quiet=null;this.track=null;return {type:'failure',reason};}
  update(d,t){
    if(!d.ready){this.state='背景取得中';return null;}
    if(!this.armed&&!this.locked){this.armed=true;this.state='待機中';return null;}
    if(this.locked){
      if(!this.locked)this.state='静止待ち';
      if(d.motion||d.invalid)this.quiet=null;else if(this.quiet===null)this.quiet=t;
      if(this.quiet!==null&&t-this.quiet>=this.config.quietMs){this.locked=false;this.armed=true;this.track=null;this.start=null;this.end=null;this.state='待機中';this.result=null;this.speed=0;}
      return null;
    }
    if(d.invalid){if(this.track)return this.fail(d.reason||'背景変動');this.reason=d.reason||'背景変動';this.state='待機中';return null;}
    if(!this.track){
      if(d.blobs.length!==1)return null;
      const p=d.blobs[0];
      // Only acquire an object entering from the top, before the upper line.
      if(p.y0>.12||p.y>=this.config.upper-.025)return null;
      this.track={...p,t,firstY:p.y,frames:1,lastAdvance:t};this.state='追跡中';this.reason='';return null;
    }
    const prev=this.track,dt=t-prev.t;
    if(dt<=0)return null;
    if(dt>this.config.maxGap)return this.fail('フレーム間隔が大きすぎます');
    if(d.blobs.length!==1)return this.fail(d.blobs.length?'複数物体で対象が不確実':'追跡対象を見失いました');
    const p=d.blobs[0],distance=Math.hypot(p.x-prev.x,p.y-prev.y),ratio=p.area/prev.area;
    const predictedY=prev.y+Math.max(0,this.speed)*dt/1000;
    if(distance>.16 || Math.abs(p.x-prev.x)>.10 || Math.abs(p.y-predictedY)>.10 || ratio<.4||ratio>(prev.y0<=.015&&p.y0<=.04?8:2.5))return this.fail('位置・大きさが不連続です');
    if(p.y<prev.y-.018)return this.fail('上向きの移動を検出しました');
    this.speed=(p.y-prev.y)/(dt/1000);
    const advanced=p.y>prev.y+.002;
    this.track={...p,t,firstY:prev.firstY,frames:prev.frames+1,lastAdvance:advanced?t:prev.lastAdvance};
    if(t-this.track.lastAdvance>600)return this.fail('下降の連続性を確認できません');
    const crossing=line=>prev.t+(line-prev.y)/(p.y-prev.y)*dt;
    if(this.start===null&&prev.y<this.config.upper&&p.y>=this.config.upper){
      if(this.track.frames<3||p.y-prev.firstY<.025||this.speed<=.02)return this.fail('上側通過前の追跡が不足しています');
      this.start=crossing(this.config.upper);
    }
    if(this.start!==null&&t-this.start>this.config.maxMs)return this.fail('下側ラインの通過時間を超過しました');
    if(this.start!==null&&prev.y<this.config.lower&&p.y>=this.config.lower){
      this.end=crossing(this.config.lower);const seconds=(this.end-this.start)/1000;
      if(seconds<=0)return this.fail('通過順序が不正です');
      this.result={type:'success',seconds,start:this.start,end:this.end,flags:[],status:'確定',method:'background-lines-v1'};
      this.state='計測完了';this.locked=true;this.armed=false;this.quiet=null;return this.result;
    }
    return null;
  }
}
export function csvCell(value){return '"'+String(value??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';}
