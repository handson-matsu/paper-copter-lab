import {performance} from 'node:perf_hooks';import {MotionDetector} from '../tracker.js';
for(const mode of ['single','noise','large-change']){
 const m=new MotionDetector(),data=new Uint8ClampedArray(320*320*4);for(let p=0;p<320*320;p++)data.set([30,30,30,255],p*4);
 for(let t=0;t<=1500;t+=50)m.process(data,320,320,t);
 for(let y=0;y<320;y++)for(let x=0;x<320;x++)if(mode==='single'?(x>140&&x<160&&y>140&&y<160):mode==='noise'?(x%8<3&&y%8<3):(x<160&&y<160))data.set([220,220,220,255],(y*320+x)*4);
 const durations=[];for(let i=0;i<220;i++){const t=performance.now();m.process(data,320,320,1600+i*40);if(i>=20)durations.push(performance.now()-t);}
 durations.sort((a,b)=>a-b);console.log(JSON.stringify({mode,p50Ms:+durations[100].toFixed(3),p95Ms:+durations[190].toFixed(3),bytes:['background','difference','mask','clean','seen','queue','hist'].reduce((n,k)=>n+m[k].byteLength,0)}));
}
