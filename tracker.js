// Pure frame analysis and timing logic. Coordinates are normalized to image height/width.
export function createDetectionWorkspace() {return {mask:null,seen:null,queue:null};}
export function detectRed(data, width, height, sensitivity = 50, previous = null, workspace = createDetectionWorkspace()) {
  const size=width*height;
  if(workspace.mask?.length!==size){workspace.mask=new Uint8Array(size);workspace.seen=new Uint8Array(size);workspace.queue=new Uint32Array(size);}
  const {mask,seen,queue}=workspace;mask.fill(0);seen.fill(0);
  const sat = .65 - sensitivity * .004, value = .30 - sensitivity * .0015;
  for (let p = 0; p < mask.length; p++) {
    const i = p * 4, r = data[i] / 255, g = data[i+1] / 255, b = data[i+2] / 255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max-min;
    let h = d === 0 ? 180 : max === r ? 60 * (((g-b)/d+6)%6) : max === g ? 60*((b-r)/d+2) : 60*((r-g)/d+4);
    if ((h < 12 + sensitivity*.16 || h > 348-sensitivity*.16) && d/(max||1) > sat && max > value) mask[p]=1;
  }
  const blobs=[];
  for(let p=0;p<mask.length;p++) {
    if(!mask[p] || seen[p]) continue;
    queue[0]=p;let count=1; seen[p]=1; let sx=0,sy=0;
    for(let q=0;q<count;q++) {
      const n=queue[q],x=n%width,y=Math.floor(n/width); sx+=x; sy+=y;
      // No per-pixel neighbor arrays or per-component growing queues.
      if(x>0 && mask[n-1]&&!seen[n-1]){seen[n-1]=1;queue[count++]=n-1;}
      if(x<width-1 && mask[n+1]&&!seen[n+1]){seen[n+1]=1;queue[count++]=n+1;}
      if(y>0 && mask[n-width]&&!seen[n-width]){seen[n-width]=1;queue[count++]=n-width;}
      if(y<height-1 && mask[n+width]&&!seen[n+width]){seen[n+width]=1;queue[count++]=n+width;}
    }
    if(count>=Math.max(5,size*.00006) && count<size*.12) blobs.push({x:sx/count/width,y:sy/count/height,area:count});
  }
  if(!blobs.length) return {point:null,reason:'赤色領域なし／面積が範囲外'};
  blobs.sort((a,b)=> previous ? Math.hypot(a.x-previous.x,a.y-previous.y)-Math.hypot(b.x-previous.x,b.y-previous.y) : b.area-a.area);
  const point=blobs[0];
  if(previous && Math.hypot(point.x-previous.x,point.y-previous.y)>.22) return {point:null,reason:'位置の飛び（追跡対象が不確実）'};
  const ambiguous=blobs.some((b,i)=>i>0 && b.area>point.area*.6 && (!previous || Math.hypot(b.x-previous.x,b.y-previous.y)<.22));
  return {point,reason:ambiguous?'複数の赤色候補':'',ambiguous};
}
export class FallTimer {
  constructor(config={}) {this.config={floor:.85,startSpeed:.10,startMs:100,stopSpeed:.045,settleMs:450,maxMs:15000,...config};this.reset();}
  reset(){this.state='待機中';this.last=null;this.run=null;this.stop=null;this.start=null;this.end=null;this.flags=new Set();this.result=null;this.speed=0;}
  flag(reason){if(this.start!==null)this.flags.add(reason);}
  finish(t,reason){this.end=t;if(reason)this.flags.add(reason);this.state='計測完了';this.result={seconds:Math.max(0,(t-this.start)/1000),start:this.start,end:t,flags:[...this.flags],status:this.flags.size?'確認待ち':'確定'};return this.result;}
  update(point,t,uncertain=false){
    if(this.result)return null;
    if(this.start!==null && t-this.start>this.config.maxMs)return this.finish(this.last?.t??t,'時間上限／着地未確認');
    if(!point){this.flag('マーカー消失');this.run=null;this.stop=null;if(this.start===null)this.state='待機中';return null;}
    if(uncertain)this.flag('複数の赤色候補');
    if(!this.last){this.last={...point,t};return null;}
    const prev=this.last,dt=t-prev.t; if(dt<=0)return null;
    this.speed=(point.y-prev.y)/(dt/1000);this.last={...point,t};
    if(dt>200){this.flag('フレーム間隔が200ms超');this.run=null;this.stop=null;return null;}
    if(this.start===null){
      if(this.speed>this.config.startSpeed && point.y<this.config.floor-.06){
        if(!this.run)this.run={t:prev.t,y:prev.y};this.state='落下検出';
        if(t-this.run.t>=this.config.startMs){this.start=this.run.t;this.state='計測中';if(uncertain)this.flag('複数の赤色候補');}
      }else{this.run=null;this.state='待機中';}
      return null;
    }
    if(point.y>=this.config.floor-.06 && Math.abs(this.speed)<=this.config.stopSpeed){
      if(!this.stop)this.stop={t:prev.t,x:prev.x,y:prev.y};
      if(Math.hypot(point.x-this.stop.x,point.y-this.stop.y)>.018)this.stop={t:prev.t,x:prev.x,y:prev.y};
      this.state='着地判定中';
      if(t-this.stop.t>=this.config.settleMs)return this.finish(this.stop.t);
    }else{this.stop=null;this.state='計測中';}
    return null;
  }
}
export function csvCell(value){return '"'+String(value??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';}
