import test from 'node:test';import assert from 'node:assert/strict';import {MotionDetector,BandTimer,bandActivity} from '../tracker.js';
const w=80,h=80,config={upper:.25,lower:.75,bandHeight:.12};
function scene(frame,object=null){
 const a=new Uint8ClampedArray(w*h*4),light=12*Math.sin(frame*.7);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const jitter=((x*13+y*7+frame*11)%17)-8;
  const value=200+light+jitter+(x<15?12*Math.sin(frame*1.9+x):0);
  a.set([value,value,value,255],(y*w+x)*4);
 }
 if(object)for(let y=object.y;y<object.y+3;y++)for(let x=38;x<41;x++)a.set([150,150,150,255],(y*w+x)*4);
 return a;
}
function model(){const m=new MotionDetector();for(let f=0;f<=15;f++)m.process(scene(f),w,h,f*100,0);assert.ok(m.ready);return m;}
test('A: learned noisy white wall with continuing exposure and grain does not start or save',()=>{
 const m=model(),timer=new BandTimer();for(let f=16;f<110;f++){const d=m.process(scene(f),w,h,1600+(f-16)*33,0,true);d.bands=m.gates(config);assert.equal(d.bands.upper.active,false);assert.equal(d.bands.lower.active,false);assert.equal(timer.update(d,1600+(f-16)*33),null);}assert.equal(timer.result,null);
});
test('B: same wall, same automatic sensitivity detects a 3x3 fast object in single frames',()=>{
 const m=model(),timer=new BandTimer();let d=m.process(scene(20,{y:19}),w,h,2000,0);d.bands=m.gates(config);assert.equal(d.bands.upper.active,true);assert.equal(timer.update(d,2000).type,'start');d=m.process(scene(21,{y:59}),w,h,2200,0);d.bands=m.gates(config);assert.equal(d.bands.lower.active,true);assert.equal(timer.update(d,2200).milliseconds,200);
});
test('MAD learns per-pixel noise, stable pixels retain a nonzero threshold floor',()=>{const m=model();assert.ok(m.noise[20*w+5]>m.noise[20*w+30]);assert.ok(m.noise[20*w+30]>=0);assert.ok(m.gates(config).upper.noise.pixelSigma>=0);});
test('gate-wide synchronous flashing and dispersed changes are rejected',()=>{
 const a=new Uint8Array(w*h);for(let y=15;y<25;y++)for(let x=0;x<w;x++)a[y*w+x]=1;const r=bandActivity(a,w,h,config);assert.equal(r.upper.active,false);assert.ok(r.upper.broad);assert.match(r.upper.reason,/同時変化/);
 a.fill(0);for(let x=0;x<w;x+=5)a[20*w+x]=1;assert.equal(bandActivity(a,w,h,config).upper.active,false);
});
test('small 3-pixel coherent objects are not excluded by an image-area minimum',()=>{const a=new Uint8Array(w*h);a[20*w+40]=1;a[20*w+41]=1;a[21*w+40]=1;assert.equal(bandActivity(a,w,h,config).upper.active,true);});
test('manual fine adjustment applies to the next frame without rebuilding background',()=>{
 const m=new MotionDetector(),flat=new Uint8ClampedArray(w*h*4);for(let p=0;p<w*h;p++)flat.set([200,200,200,255],p*4);for(let f=0;f<=15;f++)m.process(flat,w,h,f*100);
 const a=flat.slice();for(let y=19;y<22;y++)for(let x=38;x<41;x++)a.set([189,189,189,255],(y*w+x)*4);
 m.process(a,w,h,1600,-2);assert.equal(m.gates({...config,adjustment:-2}).upper.active,false);m.process(a,w,h,1633,2);assert.equal(m.gates({...config,adjustment:2}).upper.active,true);assert.ok(m.ready);
});
test('documented ambiguity: an unlearned compact blink identical to a falling object can trigger',()=>{const m=model();m.process(scene(20,{y:19}),w,h,2000,0);assert.equal(m.gates(config).upper.active,true);});
test('synchronous exposure is rejected even when only a local patch exceeds its pixel thresholds',()=>{const mask=new Uint8Array(w*h),signed=new Float32Array(w*h);for(let y=15;y<25;y++)for(let x=0;x<w;x++)signed[y*w+x]=20;mask[20*w+40]=mask[20*w+41]=mask[21*w+40]=1;const r=bandActivity(mask,w,h,config,null,{signed});assert.equal(r.upper.cluster,3);assert.equal(r.upper.active,false);assert.equal(r.upper.exposureMedian,20);});
test('gate noise criteria are learned separately from stored capture masks and cached',()=>{const m=model(),n=w*h;for(let f=0;f<m.samples;f++){m.calibrationMasks[f*n+20*w+40]=1;m.calibrationMasks[f*n+20*w+41]=1;m.calibrationMasks[f*n+21*w+40]=1;}m.gateCache=null;const r=m.gates(config);assert.ok(r.upper.noise.limit>r.lower.noise.limit);const cache=m.gateCache,seen=m.gateWorkspace.seen;m.gates(config);assert.equal(m.gateCache,cache);assert.equal(m.gateWorkspace.seen,seen);});
test('stable zero-MAD background can detect a small 12-level contrast object at automatic sensitivity',()=>{const m=new MotionDetector(),a=new Uint8ClampedArray(w*h*4);for(let p=0;p<w*h;p++)a.set([200,200,200,255],p*4);for(let t=0;t<=1500;t+=100)m.process(a,w,h,t);for(let y=19;y<22;y++)for(let x=38;x<41;x++)a.set([188,188,188,255],(y*w+x)*4);m.process(a,w,h,1600,0);assert.equal(m.noise[20*w+39],0);assert.equal(m.gates(config).upper.active,true);});
