import test from 'node:test';
import assert from 'node:assert/strict';
import {containRect,imagePoint,analysisSize,cameraError} from '../camera-utils.js';
import {detectRed,createDetectionWorkspace} from '../tracker.js';
test('landscape video uses vertical letterboxing with a shared inverse transform',()=>{
  const rect=containRect(800,600,1280,720);
  assert.deepEqual(rect,{x:0,y:75,w:800,h:450});
  assert.deepEqual(imagePoint(rect,200,300),{x:.25,y:.5});
  assert.equal(imagePoint(rect,200,30),null);
});
test('portrait video rejects left and right margins and maps floor correctly',()=>{
  const rect=containRect(800,600,720,1280);
  assert.equal(rect.x,231.25);assert.equal(rect.w,337.5);
  assert.equal(imagePoint(rect,100,300),null);assert.equal(imagePoint(rect,700,300),null);
  assert.equal(imagePoint(rect,400,510).y,.85);
});
test('DPR scaling and resize preserve normalized coordinates',()=>{
  for(const [w,h] of [[1024,768],[768,1024],[390,520]])for(const dpr of [1,2,3]){
    const rect=containRect(w*dpr,h*dpr,1920,1080);
    const point=imagePoint(rect,rect.x+rect.w*.33,rect.y+rect.h*.81);
    assert.ok(Math.abs(point.x-.33)<1e-12);assert.ok(Math.abs(point.y-.81)<1e-12);
  }
  assert.equal(containRect(0,0,1280,720),null);
});
test('analysis size caps both axes including very tall videos',()=>{
  for(const [w,h] of [[3840,2160],[720,1280],[100,10000],[640,480]]){
    const size=analysisSize(w,h);assert.ok(size.width<=320&&size.height<=320);assert.ok(size.width*size.height<=102400);
  }
});
test('camera failures include diagnostic name and playback has separate advice',()=>{
  for(const name of ['NotAllowedError','NotFoundError','NotReadableError','OverconstrainedError','SecurityError','AbortError','InvalidStateError','OtherError'])assert.ok(cameraError({name}).includes(name));
  assert.ok(cameraError({name:'NotAllowedError'},'play').includes('再生できません'));
});
test('detector buffers are reused, cleared, and safely resized',()=>{
  const workspace=createDetectionWorkspace(),data=new Uint8ClampedArray(40*40*4);
  for(let y=10;y<16;y++)for(let x=12;x<18;x++)data[(y*40+x)*4]=255;
  assert.equal(detectRed(data,40,40,50,null,workspace).point.area,36);
  const {mask,seen,queue}=workspace;data.fill(0);
  assert.equal(detectRed(data,40,40,50,null,workspace).point,null);
  assert.equal(workspace.mask,mask);assert.equal(workspace.seen,seen);assert.equal(workspace.queue,queue);
  detectRed(new Uint8ClampedArray(20*20*4),20,20,50,null,workspace);assert.equal(workspace.queue.length,400);
});
