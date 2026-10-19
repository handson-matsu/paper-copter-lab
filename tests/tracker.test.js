import test from 'node:test';
import assert from 'node:assert/strict';
import {detectRed,FallTimer,csvCell} from '../tracker.js';
const point=y=>({x:.5,y,area:20});
function falling(timer){for(let t=0;t<=1000;t+=50)timer.update(point(.2+.0006*t),t);}
function land(timer){for(let t=1050;t<=1600;t+=50)timer.update(point(.8),t);return timer.result;}
test('continuous descent starts at first movement and excludes settling delay',()=>{const timer=new FallTimer();falling(timer);const result=land(timer);assert.equal(result.seconds,1);assert.equal(result.status,'確定');assert.equal(result.end,1000);});
test('stationary marker and one-frame noise cannot start',()=>{const timer=new FallTimer();timer.update(point(.2),0);timer.update(point(.22),50);timer.update(point(.2),100);for(let t=150;t<1500;t+=50)timer.update(point(.2),t);assert.equal(timer.start,null);});
test('stopping above floor does not finish',()=>{const timer=new FallTimer();for(let t=0;t<=500;t+=50)timer.update(point(.2+t*.0006),t);for(let t=550;t<2000;t+=50)timer.update(point(.5),t);assert.equal(timer.result,null);});
test('loss during flight requires confirmation',()=>{const timer=new FallTimer();falling(timer);timer.update(null,1020);assert.equal(land(timer).status,'確認待ち');});
test('large frame gap requires confirmation',()=>{const timer=new FallTimer();falling(timer);timer.update(point(.8),1300);for(let t=1350;t<2000;t+=50)timer.update(point(.8),t);assert.ok(timer.result.flags.includes('フレーム間隔が200ms超'));});
test('timeout does not silently confirm',()=>{const timer=new FallTimer({maxMs:1200});falling(timer);timer.update(null,1300);assert.equal(timer.result.status,'確認待ち');});
test('irregular actual timestamps determine elapsed time',()=>{const timer=new FallTimer();for(const t of [0,43,101,169,222,301,377,450,514,601,670,739,811,893,957,1007])timer.update(point(.2+t*.0006),t);for(const t of [1060,1113,1171,1232,1291,1350,1419,1480,1542])timer.update(point(.8042),t);assert.equal(timer.result.end,1007);assert.equal(timer.result.seconds,1.007);});
test('red connected components reject noise and detect center',()=>{const w=100,h=100,data=new Uint8ClampedArray(w*h*4);for(let y=20;y<30;y++)for(let x=40;x<50;x++){let i=(y*w+x)*4;data[i]=220;data[i+1]=30;data[i+2]=20;data[i+3]=255;}data[0]=255;const r=detectRed(data,w,h);assert.equal(r.point.area,100);assert.equal(r.point.x,.445);assert.equal(r.point.y,.245);});
test('blank image and position jumps are rejected',()=>{const data=new Uint8ClampedArray(100*100*4);assert.equal(detectRed(data,100,100).point,null);for(let y=0;y<10;y++)for(let x=0;x<10;x++)data[(y*100+x)*4]=255;assert.equal(detectRed(data,100,100,50,{x:.8,y:.8}).point,null);});
test('CSV quotes, newlines and formula prefixes are escaped',()=>{assert.equal(csvCell('a,"b"\nc'),'"a,""b""\nc"');assert.equal(csvCell('=1+1'),'"\'=1+1"');});
test('reset clears result and supports next run',()=>{const timer=new FallTimer();falling(timer);land(timer);timer.reset();assert.equal(timer.result,null);falling(timer);assert.equal(land(timer).seconds,1);});
