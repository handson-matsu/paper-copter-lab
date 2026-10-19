import test from 'node:test';import assert from 'node:assert/strict';
import {MotionDetector,PassageTracker,csvCell} from '../tracker.js';
const p=(y,x=.5,area=40)=>({x,y,area,x0:x-.03,x1:x+.03,y0:y-.03,y1:y+.03});
const d=blobs=>({ready:true,blobs,motion:blobs.length>0});
function armed(){const tr=new PassageTracker();tr.update(d([]),0);tr.update(d([]),800);return tr;}
function flight(tr,until=.8){let event;for(let i=0;i<=Math.round((until-.05)/.025);i++)event=tr.update(d([p(.05+i*.025)]),1000+i*50)||event;return event;}
function image(w=100,h=100,value=30){const a=new Uint8ClampedArray(w*h*4);for(let i=0;i<a.length;i+=4){a[i]=a[i+1]=a[i+2]=value;a[i+3]=255;}return a;}
function readyDetector(){const m=new MotionDetector(),a=image();for(let t=0;t<=900;t+=50)m.process(a,100,100,t);assert.ok(m.ready);return m;}
test('same descending object crosses both lines with interpolated timestamps',()=>{const tr=armed(),result=flight(tr);assert.equal(result.type,'success');assert.ok(Math.abs(result.seconds-1)<1e-9);assert.equal(tr.state,'計測完了');});
test('irregular frame times determine duration without fixed fps',()=>{const tr=armed();let result;for(const t of [0,40,91,140,211,280,330,401,472,550,622,691,760,830,900,970,1040,1111,1191,1250,1330,1410,1500])result=tr.update(d([p(.05+t*.0005)]),1000+t)||result;assert.ok(Math.abs(result.seconds-1)<1e-9);});
test('motion beginning below upper line never starts timing',()=>{const tr=armed();for(let i=0;i<15;i++)tr.update(d([p(.4+i*.02)]),1000+i*50);assert.equal(tr.start,null);assert.equal(tr.track,null);});
test('upper passage without prior continuity fails with no seconds',()=>{const tr=armed();tr.update(d([p(.14)]),1000);const e=tr.update(d([p(.26)]),1100);assert.equal(e.type,'failure');assert.equal(e.seconds,undefined);});
test('loss fails immediately and unrelated target cannot replace it',()=>{const tr=armed();flight(tr,.4);const e=tr.update(d([]),1800);assert.equal(e.type,'failure');for(let i=0;i<30;i++)assert.equal(tr.update(d([p(.05+i*.025,.8)]),1850+i*50),null);assert.equal(tr.result,null);assert.equal(tr.state,'測定失敗');});
for(const [name,next] of [['jump',p(.4,.9)],['size change',p(.1,.5,300)],['reverse',p(.01)],['multiple',null]])test(name+' is rejected',()=>{const tr=armed();tr.update(d([p(.08)]),1000);const e=tr.update(d(next?[next]:[p(.1),p(.1,.8)]),1050);assert.equal(e.type,'failure');assert.equal(tr.result,null);});
test('large processing gap fails',()=>{const tr=armed();tr.update(d([p(.08)]),1000);assert.equal(tr.update(d([p(.12)]),1300).type,'failure');});
test('stationary local object cannot produce a measurement',()=>{const tr=armed();tr.update(d([p(.08)]),1000);for(let t=1050;t<1800;t+=50)tr.update(d([p(.08)]),t);assert.equal(tr.state,'測定失敗');assert.equal(tr.result,null);});
test('completion waits for 800ms empty background before next acquisition',()=>{const tr=armed();flight(tr);tr.update(d([p(.8)]),3000);tr.update(d([]),3100);tr.update(d([]),3800);assert.equal(tr.state,'計測完了');tr.update(d([]),3900);assert.equal(tr.state,'待機中');assert.equal(tr.start,null);assert.equal(flight(tr).type,'success');});
test('background must remain still while captured',()=>{const m=new MotionDetector();for(let t=0;t<2000;t+=50)m.process(image(100,100,t%100?30:100),100,100,t);assert.equal(m.ready,false);});
test('background differences detect any color and remove isolated noise',()=>{for(const rgb of [[220,220,220],[20,200,40],[30,30,230]]){const m=readyDetector(),a=image();for(let y=10;y<20;y++)for(let x=40;x<50;x++)a.set([...rgb,255],(y*100+x)*4);a.set([255,255,255,255],0);const r=m.process(a,100,100,1000);assert.equal(r.blobs.length,1);assert.ok(Math.abs(r.blobs[0].x-.445)<.01);}});
test('moderate global lighting shift does not create a target',()=>{const m=readyDetector();const r=m.process(image(100,100,55),100,100,1000);assert.equal(r.blobs.length,0);assert.equal(r.invalid,false);});
test('large lighting changes invalidate a frame',()=>{const m=readyDetector();assert.equal(m.process(image(100,100,200),100,100,1000).invalid,true);});
test('large foreground/camera changes are rejected',()=>{const m=readyDetector(),a=image();for(let y=0;y<50;y++)for(let x=0;x<50;x++)a.set([240,240,240,255],(y*100+x)*4);assert.ok(m.process(a,100,100,1000).invalid);});
test('same-size frames reuse buffers and background stays frozen',()=>{const m=readyDetector(),b=m.background,q=m.queue;m.process(image(),100,100,1000);assert.equal(m.background,b);assert.equal(m.queue,q);assert.equal(m.background[0],30);m.reset();assert.equal(m.ready,false);});
test('CSV escapes quotes and formulas',()=>{assert.equal(csvCell('a,"b"\nc'),'"a,""b""\nc"');assert.equal(csvCell('=1+1'),'"\'=1+1"');});
test('top-edge clipping permits limited area growth only at the image entry',()=>{const tr=armed();tr.update(d([p(.015,.5,16)]),1000);assert.equal(tr.update(d([p(.04,.5,96)]),1050),null);assert.equal(tr.state,'追跡中');});
test('settings-style fresh tracker stays in quiet confirmation until armed',()=>{const tr=new PassageTracker();assert.equal(tr.state,'静止待ち');tr.update(d([p(.04)]),0);tr.update(d([p(.1)]),800);assert.equal(tr.track,null);assert.equal(tr.armed,false);});
test('valid lower passage requires a recorded upper passage',()=>{const tr=armed();tr.update(d([p(.05)]),1000);let e;for(let i=0;i<10;i++)e=tr.update(d([p(.05)]),1050+i*50);assert.equal(tr.start,null);assert.equal(tr.result,null);});
