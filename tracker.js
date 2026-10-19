// Background and tracking buffers contain only reduced-resolution local pixels.
export class MotionDetector {
  constructor(){this.reset();}
  reset(){this.ready=false;this.started=null;this.samples=0;this.width=0;this.height=0;this.lastAdapt=null;this.captureFrames=null;this.gateCache=null;this.noise=null;this.calibrationMasks=null;this.gateWorkspace={};}
  allocate(w,h){
    if(this.width===w&&this.height===h)return;
    this.reset();this.width=w;this.height=h;const n=w*h;
    this.background=new Float32Array(n*3);this.captureFrames=new Uint8Array(n*3*15);this.difference=new Uint8Array(n);this.signedDifference=new Float32Array(n);
    this.mask=new Uint8Array(n);this.clean=new Uint8Array(n);this.seen=new Uint8Array(n);this.queue=new Uint32Array(n);
    this.hist=new Uint32Array(511*3);this.noise=new Float32Array(n);
  }
  process(data,w,h,t,adjustment=0,adapt=false){
    this.allocate(w,h);const n=w*h,multiplier=Math.pow(1.12,-Math.max(-5,Math.min(5,adjustment))),threshold=Math.max(6,10*multiplier);
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
        // Learn residual temporal noise after removing each frame's global exposure offset.
        const offsets=new Float32Array(this.samples*3);
        for(let f=0;f<this.samples;f++){
          this.hist.fill(0);let count=0;
          for(let p=0;p<n;p+=8){for(let c=0;c<3;c++)this.hist[c*511+Math.round(this.captureFrames[f*n*3+p*3+c]-this.background[p*3+c])+255]++;count++;}
          for(let c=0;c<3;c++){let sum=0;for(let i=0;i<511;i++){sum+=this.hist[c*511+i];if(sum>=count/2){offsets[f*3+c]=i-255;break;}}}
        }
        for(let p=0;p<n;p++)for(let c=0;c<3;c++){
          for(let f=0;f<this.samples;f++)scratch[f]=Math.min(255,Math.abs(this.captureFrames[f*n*3+p*3+c]-this.background[p*3+c]-offsets[f*3+c]));
          scratch.sort();this.noise[p]=Math.max(this.noise[p],1.4826*scratch[Math.floor(this.samples/2)]);
        }
        this.calibrationMasks=new Uint8Array(n*this.samples);
        for(let f=0;f<this.samples;f++)for(let p=0;p<n;p++){
          let diff=0;for(let c=0;c<3;c++)diff=Math.max(diff,Math.abs(this.captureFrames[f*n*3+p*3+c]-this.background[p*3+c]-offsets[f*3+c]));
          this.calibrationMasks[f*n+p]=diff>10+4.5*this.noise[p]?1:0;
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
      let diff=0,signed=0;for(let c=0;c<3;c++){const raw=data[p*4+c]-this.background[p*3+c];rawMaxDifference=Math.max(rawMaxDifference,Math.abs(raw));diff=Math.max(diff,Math.abs(raw-offsets[c]));signed+=raw-offsets[c];}
      this.signedDifference[p]=signed/3;maxDifference=Math.max(maxDifference,diff);
      this.difference[p]=Math.min(255,diff);
      if(diff>Math.max(6,(10+4.5*this.noise[p])*multiplier)){this.mask[p]=1;changed++;}
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
  gates(config={}){
    const key=[config.upper,config.lower,config.bandHeight].join(',');
    if(!this.gateCache||this.gateCache.key!==key){
      const samples={upper:[],lower:[]},n=this.width*this.height;this.gateWorkspace.signed=null;
      for(let f=0;f<this.samples;f++){
        const r=bandActivity(this.calibrationMasks.subarray(f*n,(f+1)*n),this.width,this.height,config,null,this.gateWorkspace);
        for(const name of ['upper','lower'])samples[name].push(r[name].broad?0:r[name].cluster);
      }
      const baseline={};
      for(const name of ['upper','lower']){
        const sorted=samples[name].sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)]||0;
        const deviations=sorted.map(v=>Math.abs(v-median)).sort((a,b)=>a-b),mad=deviations[Math.floor(deviations.length/2)]||0;
        const center=name==='upper'?(config.upper??.25):(config.lower??.75),height=config.bandHeight??.12;
        const top=Math.max(0,Math.floor((center-height/2)*this.height)),bottom=Math.min(this.height,Math.ceil((center+height/2)*this.height));
        const pixelNoise=Array.from(this.noise.subarray(top*this.width,bottom*this.width)).sort((a,b)=>a-b);
        baseline[name]={median,mad,pixelSigma:pixelNoise[Math.floor(pixelNoise.length/2)]||0,limit:Math.max(3,Math.ceil(median+6*1.4826*mad+1))};
      }
      this.gateCache={key,baseline};
    }
    this.gateWorkspace.signed=this.signedDifference;return bandActivity(this.mask,this.width,this.height,config,this.gateCache.baseline,this.gateWorkspace);
  }

}
// Gate-local coherence, independent of object tracking or consecutive frames.
export function bandActivity(mask,width,height,config={},baseline=null,workspace={}){
  const {upper=.25,lower=.75,bandHeight=.12}=config,n=width*height;
  if(workspace.seen?.length!==n){workspace.seen=new Uint8Array(n);workspace.queue=new Uint32Array(n);workspace.columns=new Uint8Array(width);workspace.signedHistogram=new Uint32Array(511);}
  const {seen,queue,columns}=workspace;
  const read=(center,name)=>{
    const top=Math.max(0,Math.floor((center-bandHeight/2)*height)),bottom=Math.min(height,Math.ceil((center+bandHeight/2)*height));
    seen.fill(0);columns.fill(0);let pixels=0,cluster=0;
    for(let y=top;y<bottom;y++)for(let x=0;x<width;x++){
      const p=y*width+x;if(!mask[p])continue;pixels++;columns[x]=1;if(seen[p])continue;
      queue[0]=p;seen[p]=1;let length=1;
      for(let q=0;q<length;q++){
        const i=queue[q],ix=i%width,iy=Math.floor(i/width);
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          const xx=ix+dx,yy=iy+dy;if((!dx&&!dy)||xx<0||xx>=width||yy<top||yy>=bottom)continue;
          const j=yy*width+xx;if(mask[j]&&!seen[j]){seen[j]=1;queue[length++]=j;}
        }
      }
      cluster=Math.max(cluster,length);
    }
    const fraction=pixels/(Math.max(1,bottom-top)*width),coverage=columns.reduce((a,b)=>a+b,0)/width;
    let broad=fraction>.35||(coverage>.65&&fraction>.08);
    const noise=baseline?.[name]||{median:0,mad:0,limit:3};
    let exposureMedian=0;
    if(workspace.signed){
      const histogram=workspace.signedHistogram;histogram.fill(0);let count=0;
      for(let i=top*width;i<bottom*width;i+=4){histogram[Math.round(workspace.signed[i])+255]++;count++;}
      let sum=0;for(let i=0;i<511;i++){sum+=histogram[i];if(sum>=count/2){exposureMedian=i-255;break;}}
      if(Math.abs(exposureMedian)>Math.max(8,(noise.pixelSigma||0)*1.5))broad=true;
    }
    const limit=Math.max(3,Math.ceil(noise.limit*Math.pow(1.08,-(config.adjustment||0))));
    const active=!broad&&cluster>=limit;
    const reason=broad?'ゲート全体の同時変化をノイズ除外':active?'局所的なまとまりが学習ノイズ基準を超過':pixels===0?'画素ごとのノイズ閾値以内':cluster<3?'散在画素／まとまり不足': '局所変化が学習ノイズ基準以下';
    return {active,pixels,cluster,broad,fraction,coverage,exposureMedian,noise,limit,reason,top:top/height,bottom:bottom/height};
  };
  return {upper:read(upper,'upper'),lower:read(lower,'lower')};
}
export class BandTimer {
  constructor(config={}){this.config={upper:.25,lower:.75,bandHeight:.12,minCluster:3,cooldownMs:600,maxMs:5000,...config};this.reset();}
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
