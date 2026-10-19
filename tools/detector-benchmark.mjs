import {performance} from 'node:perf_hooks';
import {detectRed,createDetectionWorkspace} from '../tracker.js';
for(const scenario of ['marker','full-red','noise']){
  const w=320,h=320,data=new Uint8ClampedArray(w*h*4),workspace=createDetectionWorkspace();
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(scenario==='full-red'||(scenario==='noise'?(x%4<3&&y%4<3):(x>140&&x<160&&y>140&&y<160)))data[(y*w+x)*4]=230;
  const durations=[];for(let i=0;i<220;i++){const t=performance.now();detectRed(data,w,h,50,null,workspace);if(i>=20)durations.push(performance.now()-t);}
  durations.sort((a,b)=>a-b);
  console.log(JSON.stringify({scenario,frames:200,p50Ms:+durations[100].toFixed(3),p95Ms:+durations[190].toFixed(3),maxMs:+durations.at(-1).toFixed(3),scratchBytes:workspace.mask.byteLength+workspace.seen.byteLength+workspace.queue.byteLength}));
}
