import {performance} from 'node:perf_hooks';import {MotionDetector} from '../tracker.js';
for(const mode of ['single','noise','large-change']){
 const m=new MotionDetector(),data=new Uint8ClampedArray(320*320*4);for(let p=0;p<320*320;p++)data.set([30,30,30,255],p*4);
 let capturePeakMs=0;for(let t=0;t<=1500;t+=50){const begin=performance.now();m.process(data,320,320,t);if(m.ready)m.gates({upper:.25,lower:.75});capturePeakMs=Math.max(capturePeakMs,performance.now()-begin);}
 for(let y=0;y<320;y++)for(let x=0;x<320;x++)if(mode==='single'?(x>140&&x<160&&y>140&&y<160):mode==='noise'?(x%8<3&&y%8<3):(x<160&&y<160))data.set([220,220,220,255],(y*320+x)*4);
 const durations=[];for(let i=0;i<220;i++){const t=performance.now();m.process(data,320,320,1600+i*40);m.gates({upper:.25,lower:.75});if(i>=20)durations.push(performance.now()-t);}
 durations.sort((a,b)=>a-b);console.log(JSON.stringify({mode,capturePeakMs:+capturePeakMs.toFixed(2),p50Ms:+durations[100].toFixed(3),p95Ms:+durations[190].toFixed(3),bytes:['background','difference','mask','clean','seen','queue','hist','noise','signedDifference','calibrationMasks'].reduce((n,k)=>n+m[k].byteLength,0)+Object.values(m.gateWorkspace).reduce((n,v)=>n+(v?.byteLength||0),0)-(m.gateWorkspace.signed?.byteLength||0)}));
}
