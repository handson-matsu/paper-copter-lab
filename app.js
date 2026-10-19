import {MotionDetector,BandTimer,csvCell} from './tracker.js';
import {containRect,imagePoint,analysisSize,cameraError,inspectFrame} from './camera-utils.js';
const $=id=>document.getElementById(id),video=$('video'),overlay=$('overlay'),ctx=overlay.getContext('2d');
const analysis=document.createElement('canvas'),ax=analysis.getContext('2d',{willReadFrequently:true});
const differenceCanvas=$('differenceCanvas'),differenceContext=differenceCanvas.getContext('2d');let differenceImage=null;
const detector=new MotionDetector();let tracker=new BandTimer();
let stream=null,callback=null,usingVideoFrames=false,sourceWidth=0,sourceHeight=0,lastFrame=0,lastMediaTime=-1,generation=0;
let frameReads=0,inputInfo=null,lastInputHash=null,inputChanges=0;
let adjustment=0,startAdjustment=0;
let backgroundRequested=false,upper=.25,lower=.75,dragLine=null,snapshot={},records=[],savedConditions={},fps=0;
const labels={experiment:'実験名',group:'グループ名',wingLength:'羽根の長さ(mm)',wingWidth:'羽根の幅(mm)',bodyLength:'胴体の長さ(mm)',weights:'重りの数',height:'落下高さ(cm)',memo:'メモ'};
function warn(text){$('message').textContent=text;}
function store(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{$('storageMessage').textContent='端末への保存に失敗しました。記録は現在の画面に残っています。再読み込み前にCSVを書き出してください。';warn('端末への保存に失敗しました。測定結果からCSVを書き出してください。');return false;}}
try{const r=JSON.parse(localStorage.getItem('copter.records')||'[]');if(!Array.isArray(r))throw Error();records=r.filter(v=>v&&typeof v.id==='string'&&typeof v.seconds==='number'&&v.conditions&&Array.isArray(v.flags));savedConditions=JSON.parse(localStorage.getItem('copter.conditions')||'{}')||{};}catch{$('storageMessage').textContent='保存データを読み込めませんでした。元データを上書きする前にブラウザの保存内容を確認してください。';}
for(const [k,v] of Object.entries(savedConditions)){if($('conditionForm').elements.namedItem(k))$('conditionForm').elements.namedItem(k).value=String(v);}
function conditions(){return Object.fromEntries(new FormData($('conditionForm')));}
$('conditionForm').addEventListener('input',()=>store('copter.conditions',conditions()));
for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>{for(const s of ['measure','conditions','results'])$(s).hidden=s!==b.dataset.tab;for(const n of document.querySelectorAll('[data-tab]'))n.setAttribute('aria-selected',String(n===b));};
function renderRecords(){
  $('history').replaceChildren();$('count').textContent=records.length;$('empty').hidden=records.length>0;
  for(const r of records){const tr=document.createElement('tr');const cell=()=>{const td=document.createElement('td');tr.append(td);return td;};
    let td=cell();td.textContent=new Date(r.date).toLocaleString('ja-JP');let small=document.createElement('small');small.textContent=(r.conditions.experiment||'名称未設定')+' / '+(r.method==='background-bands-v1'?'簡易帯通過':r.method==='background-lines-v1'?'旧・追跡ライン間通過':'旧方式の落下時間');td.append(small);
    td=cell();td.textContent=r.conditions.group||'グループ未設定';small=document.createElement('small');small.textContent=Object.entries(labels).filter(([k])=>!['experiment','group'].includes(k)).map(([k,label])=>`${label}: ${r.conditions[k]||'—'}`).join(' / ');td.append(small);
    td=cell();const strong=document.createElement('strong');strong.textContent=r.seconds.toFixed(3);td.append(strong,' 秒');
    td=cell();td.textContent=r.status;small=document.createElement('small');small.textContent=r.flags.join(' / ');td.append(small);
    td=cell();if(r.status==='確認待ち'){const b=document.createElement('button');b.textContent='確認して確定';b.onclick=()=>{r.status='手動確認済み';store('copter.records',records);renderRecords();};td.append(b);}
    const del=document.createElement('button');del.textContent='削除';del.onclick=()=>{if(confirm(`${r.seconds.toFixed(3)}秒の記録を削除しますか？`)){records=records.filter(x=>x.id!==r.id);store('copter.records',records);renderRecords();}};td.append(del);$('history').append(tr);
  }
}
renderRecords();
$('export').onclick=()=>{const keys=Object.keys(labels),rows=[['測定日時',...Object.values(labels),'時間(秒)','状態','確認理由','開始時刻(ms・ページ基準)','終了時刻(ms・ページ基準)','判定設定','計測方式','時間(ms)'],...records.map(r=>[r.date,...keys.map(k=>r.conditions[k]),r.seconds.toFixed(3),r.status,r.flags.join(' / '),r.start,r.end,JSON.stringify(r.config),r.method||'legacy-red-marker',(r.milliseconds??r.seconds*1000).toFixed(3)])];const blob=new Blob(['\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`paper-copter-${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
function resetBandIndicators(){for(const [id,label] of [['upperStatus','上側'],['lowerStatus','下側']]){$(id).textContent=label+'：未検出';$(id).style.background='';}}
function resetBackground(){resetBandIndicators();frameReads=0;inputInfo=null;lastInputHash=null;inputChanges=0;detector.reset();backgroundRequested=false;tracker=new BandTimer({upper,lower});$('backgroundStatus').textContent='背景：未取得';$('captureBackground').disabled=!stream;$('state').textContent='背景未取得';$('time').textContent='—';$('milliseconds').textContent='— ms';}
$('captureBackground').onclick=()=>{
  if(!stream)return;
  resetBandIndicators();detector.reset();tracker=new BandTimer({upper,lower});backgroundRequested=true;
  $('time').textContent='—';$('milliseconds').textContent='— ms';$('resultNotice').textContent='';warn('背景を約1.5秒撮影します。多少の動きがあっても取得します。');
};
function changedSettings(){
  if(tracker.start!==null&&!tracker.locked){tracker.fail('ライン・感度の変更で中断');$('time').textContent='—';$('milliseconds').textContent='— ms';$('resultNotice').textContent='設定変更で測定失敗。数値は保存しません。';}
  else if(!tracker.locked)tracker=new BandTimer({upper,lower});
  tracker.config.upper=upper;tracker.config.lower=lower;
  $('upperLine').value=upper*100;$('lowerLine').value=lower*100;
  $('lineInfo').textContent=`上側${Math.round(upper*100)}% / 下側${Math.round(lower*100)}%`;$('state').textContent=tracker.state;
}
function setLine(which,y){if(which==='upper')upper=Math.max(.10,Math.min(lower-.15,.65,y));else lower=Math.min(.90,Math.max(upper+.15,.30,y));changedSettings();}
$('upperLine').oninput=e=>setLine('upper',Number(e.target.value)/100);
$('lowerLine').oninput=e=>setLine('lower',Number(e.target.value)/100);
function adjustSensitivity(delta){
  adjustment=Math.max(-5,Math.min(5,adjustment+delta));
  $('sensitivityValue').textContent=adjustment===0?'自動（補正 0）':`自動＋微調整 ${adjustment>0?'+':''}${adjustment}`;
  $('sensitivityMinus').disabled=adjustment<=-5;$('sensitivityPlus').disabled=adjustment>=5;
  tracker.config.adjustment=adjustment;
}
$('sensitivityMinus').onclick=()=>adjustSensitivity(-1);
$('sensitivityPlus').onclick=()=>adjustSensitivity(1);
$('debugToggle').onchange=()=>{$('debug').hidden=!$('debugToggle').checked;$('diagnostics').hidden=!$('debugToggle').checked;};
function videoRect(){return containRect(overlay.width,overlay.height,video.videoWidth,video.videoHeight);}
function pointerPoint(e){const b=overlay.getBoundingClientRect();return imagePoint(videoRect(),(e.clientX-b.left)*overlay.width/b.width,(e.clientY-b.top)*overlay.height/b.height);}
overlay.onpointerdown=e=>{
  const p=pointerPoint(e);if(!p)return;
  const r=videoRect(),b=overlay.getBoundingClientRect(),tolerance=30*overlay.height/b.height/r.h;
  if(Math.min(Math.abs(p.y-upper),Math.abs(p.y-lower))>tolerance)return;
  dragLine=Math.abs(p.y-upper)<Math.abs(p.y-lower)?'upper':'lower';overlay.setPointerCapture(e.pointerId);setLine(dragLine,p.y);
};
overlay.onpointermove=e=>{if(!dragLine)return;const p=pointerPoint(e);if(p)setLine(dragLine,p.y);};
overlay.onpointerup=overlay.onpointercancel=()=>{dragLine=null;};
function resize(){const b=overlay.getBoundingClientRect();if(!b.width||!b.height)return;const scale=Math.min(devicePixelRatio||1,2,1920/Math.max(b.width,b.height));const w=Math.round(b.width*scale),h=Math.round(b.height*scale);if(overlay.width!==w||overlay.height!==h){overlay.width=w;overlay.height=h;}}
new ResizeObserver(resize).observe($('stage'));
function saveResult(result){
  const record={...result,id:crypto.randomUUID(),date:new Date().toISOString(),conditions:{...snapshot},config:{...tracker.config,sensitivityAdjustment:startAdjustment,endSensitivityAdjustment:adjustment,backgroundModel:'median-mad-gate-noise-v2',backgroundSamples:detector.samples,gateNoise:detector.gateCache?.baseline}};
  records.unshift(record);const ok=store('copter.records',records);renderRecords();
  $('time').textContent=result.seconds.toFixed(3);$('milliseconds').textContent=result.milliseconds.toFixed(1)+' ms';$('resultNotice').textContent=ok?'簡易帯通過時間を自動保存しました。':'保存失敗：CSVを書き出してください。';
}
function schedule(token){if(token!==generation||!stream)return;usingVideoFrames=typeof video.requestVideoFrameCallback==='function';callback=usingVideoFrames?video.requestVideoFrameCallback(t=>frame(t,token)):requestAnimationFrame(t=>frame(t,token));}
function draw(d){
  ctx.clearRect(0,0,overlay.width,overlay.height);const r=videoRect();if(!r)return;const scale=overlay.width/Math.max(1,overlay.getBoundingClientRect().width);
  for(const [line,label,color,hit] of [[upper,'上側 START','#f6c969',tracker.upperHitAt],[lower,'下側 END','#77d5ff',tracker.lowerHitAt]]){
    const flash=hit!==null&&performance.now()-hit<700;ctx.fillStyle=flash?'rgba(70,240,140,.55)':(line===upper?'rgba(246,201,105,.16)':'rgba(119,213,255,.16)');ctx.fillRect(r.x,r.y+(line-tracker.config.bandHeight/2)*r.h,r.w,tracker.config.bandHeight*r.h);
    ctx.strokeStyle=color;ctx.lineWidth=3*scale;ctx.beginPath();ctx.moveTo(r.x,r.y+line*r.h);ctx.lineTo(r.x+r.w,r.y+line*r.h);ctx.stroke();
    ctx.fillStyle=color;ctx.font=`${14*scale}px sans-serif`;ctx.fillText(label,r.x+8*scale,r.y+line*r.h-8*scale);
  }
  const box=(p,color,width)=>{ctx.strokeStyle=color;ctx.lineWidth=width*scale;ctx.strokeRect(r.x+p.x0*r.w,r.y+p.y0*r.h,(p.x1-p.x0)*r.w,(p.y1-p.y0)*r.h);};
  for(const p of d.regions||d.blobs)box(p,'#69f2a3',1);

}
function drawDiagnostics(d,w,h){
  if(differenceCanvas.width!==w||differenceCanvas.height!==h){differenceCanvas.width=w;differenceCanvas.height=h;differenceImage=differenceContext.createImageData(w,h);}
  if(!differenceImage)differenceImage=differenceContext.createImageData(w,h);
  for(let p=0;p<w*h;p++){const v=detector.ready?detector.difference?.[p]||0:0;differenceImage.data[p*4]=v;differenceImage.data[p*4+1]=v;differenceImage.data[p*4+2]=v;differenceImage.data[p*4+3]=255;}
  differenceContext.putImageData(differenceImage,0,0);differenceContext.strokeStyle='#49ff8b';differenceContext.lineWidth=1;
  for(const b of d.regions||d.blobs)differenceContext.strokeRect(b.x0*w,b.y0*h,(b.x1-b.x0)*w,(b.y1-b.y0)*h);
}
function updateBandStatus(d,t){
  for(const [name,label,at] of [['upper','上側',tracker.upperHitAt],['lower','下側',tracker.lowerHitAt]]){
    const el=$(name+'Status'),active=!!d.bands?.[name].active;
    el.textContent=`${label}：${active?'反応中':'反応なし'}${at!==null?' / 検出 '+at.toFixed(1)+'ms':''}`;
    el.style.background=at!==null&&t-at<700?'#a7f0bc':active?'#f9e5ad':'';
  }
}
function frame(t,token){
  if(token!==generation||!stream)return;
  try{
    if(video.readyState>=2&&video.videoWidth&&video.videoHeight){
      if(sourceWidth!==video.videoWidth||sourceHeight!==video.videoHeight){stopCamera('カメラ映像の縦横サイズが変化しました。再起動し、背景を取得し直してください。');return;}
      if(!usingVideoFrames&&video.currentTime===lastMediaTime){schedule(token);return;}
      lastMediaTime=video.currentTime;fps=lastFrame?1000/(t-lastFrame):0;lastFrame=t;const begin=performance.now();
      const {width:w,height:h}=analysisSize(video.videoWidth,video.videoHeight);if(analysis.width!==w||analysis.height!==h){analysis.width=w;analysis.height=h;}
      let d={ready:false,blobs:[],motion:false,reason:'静止背景を取得してください'};
      if(backgroundRequested){
        ax.drawImage(video,0,0,w,h);const pixels=ax.getImageData(0,0,w,h).data;frameReads++;
        if($('debugToggle').checked){inputInfo=inspectFrame(pixels);if(lastInputHash!==null&&inputInfo.hash!==lastInputHash)inputChanges++;lastInputHash=inputInfo.hash;}
        d=detector.process(pixels,w,h,t,adjustment,tracker.start===null&&!tracker.locked);
      }
      $('backgroundStatus').textContent=!backgroundRequested?'背景：未取得':detector.ready?`背景：取得済み（${detector.samples}フレーム中央値）`:`背景：取得中 ${Math.round((d.progress||0)*100)}%`;
      if(detector.ready){d.bands=detector.gates({...tracker.config,adjustment});}
      const priorState=tracker.state,event=backgroundRequested?tracker.update(d,t):null;
      updateBandStatus(d,t);
      if(priorState!==tracker.state){
        const messages={'待機中':'準備完了。紙コプターを撮影範囲より上から落としてください。','計測中':'上側を検出しました。下側判定帯の反応待ちです。','静止待ち':'画面が静止するのを待っています。','背景取得中':'背景を約1.5秒撮影中。多少の動きがあっても取得します。','計測完了':'計測完了。600ms後に次の測定を受け付けます。','測定失敗':tracker.reason+'。数値は保存しません。画面内を空にしてください。'};
        if(messages[tracker.state])warn(messages[tracker.state]);
      }
      if(event?.type==='start'){startAdjustment=adjustment;snapshot=conditions();$('time').textContent='0.000';$('resultNotice').textContent='上側を検出しました';}
      if(event?.type==='success')saveResult(event);
      if(event?.type==='failure'){$('time').textContent='—';$('milliseconds').textContent='— ms';$('resultNotice').textContent=event.reason+'。数値は保存しません。';}
      $('state').textContent=backgroundRequested?tracker.state:'背景未取得';
      $('detection').textContent=tracker.reason||d.reason||'背景を取得してください';
      if(tracker.start!==null&&!tracker.locked){$('time').textContent=((t-tracker.start)/1000).toFixed(3);$('milliseconds').textContent=(t-tracker.start).toFixed(1)+' ms';}
      draw(d);
      if($('debugToggle').checked){drawDiagnostics(d,w,h);$('debug').textContent=`背景: ${detector.ready?'取得済み':'未取得'} / 動体反応: ${(d.regions||d.blobs).length} / 枠用候補（計測不使用）: ${d.blobs.length}\nCanvas取得: ${frameReads}回 / 入力変化: ${inputChanges}回 / video時刻: ${video.currentTime.toFixed(3)}s\n入力: hash=${inputInfo?.hash||'—'} RGB=${inputInfo?.min??'—'}..${inputInfo?.max??'—'} 平均=${inputInfo?.mean.toFixed(1)??'—'} α=${inputInfo?.alpha.toFixed(0)??'—'}\n差分: 補正前最大=${d.stats?.rawMaxDifference.toFixed(1)??'—'} 補正後最大=${d.stats?.maxDifference.toFixed(1)??'—'} 閾値下限=${d.stats?.threshold.toFixed(2)??'—'}\n変化画素: ${d.stats?.changedPixels??'—'} / 枠用小面積除外=${d.stats?.smallRejected??'—'} 枠用大面積除外=${d.stats?.largeRejected??'—'}\n背景更新: ${d.stats?.backgroundUpdating?'待機中の非前景画素のみ':'停止'} / 解析時刻: ${t.toFixed(1)}ms\n帯内変化画素: 上=${d.bands?.upper.pixels??0} / 下=${d.bands?.lower.pixels??0} / 連結画素: 上=${d.bands?.upper.cluster??0} 下=${d.bands?.lower.cluster??0}\nゲート基準: 上=${d.bands?.upper.limit??'—'}（中央値${d.bands?.upper.noise.median??'—'} MAD${d.bands?.upper.noise.mad??'—'}） 下=${d.bands?.lower.limit??'—'}（中央値${d.bands?.lower.noise.median??'—'} MAD${d.bands?.lower.noise.mad??'—'}）\n画素ノイズσ中央値: 上=${d.bands?.upper.noise.pixelSigma?.toFixed(2)??'—'} 下=${d.bands?.lower.noise.pixelSigma?.toFixed(2)??'—'}\nゲート露出変動中央値: 上=${d.bands?.upper.exposureMedian??'—'} 下=${d.bands?.lower.exposureMedian??'—'}\n上側理由: ${d.bands?.upper.reason??'取得中'}\n下側理由: ${d.bands?.lower.reason??'取得中'}\n自動ノイズ感度の微調整: ${adjustment}\n物体追跡・面積上限・複数候補制限: 計測には使用しません\n上側通過: ${tracker.start??'—'} ms / 下側通過: ${tracker.end??'—'} ms\n処理: ${fps.toFixed(1)} fps / ${(performance.now()-begin).toFixed(2)} ms / ${w}×${h}\n理由: ${tracker.reason||d.reason||'なし'}`;}
    }
  }catch(e){stopCamera(`解析を継続できません（${e.name}）。再起動してください。`);return;}
  schedule(token);
}
function stopCamera(reason='カメラを停止しました。再起動できます。'){
  generation++;if(callback!==null){if(usingVideoFrames)video.cancelVideoFrameCallback(callback);else cancelAnimationFrame(callback);}callback=null;
  const interrupted=tracker.start!==null&&!tracker.locked;
  if(interrupted)tracker.fail('カメラ停止／計測中断');
  if(stream)for(const track of stream.getTracks()){track.onended=null;track.stop();}stream=null;video.pause();video.srcObject=null;sourceWidth=0;sourceHeight=0;resetBackground();ctx.clearRect(0,0,overlay.width,overlay.height);$('placeholder').hidden=false;$('startCamera').disabled=false;$('stopCamera').disabled=true;$('cameraState').textContent='CAMERA OFF';$('detection').textContent='カメラ停止中';if(interrupted){$('state').textContent='測定失敗';$('resultNotice').textContent='カメラ停止／計測中断。数値は保存しません。';}warn(reason);
}
$('stopCamera').onclick=()=>stopCamera();
$('startCamera').onclick=async()=>{
  if(!window.isSecureContext){warn('カメラにはHTTPSが必要です。GitHub PagesのHTTPS URL、またはlocalhostで開いてください。');return;}
  if(!navigator.mediaDevices?.getUserMedia){warn('このブラウザではカメラAPIを利用できません。SafariまたはChromeで直接開いてください。');return;}
  resetBackground();$('startCamera').disabled=true;$('stopCamera').disabled=false;warn('カメラの許可・起動を待っています。取り消す場合は停止を押してください。');const token=++generation;let phase='capture';
  try{const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:60,max:60}},audio:false});if(token!==generation){media.getTracks().forEach(t=>t.stop());return;}stream=media;video.muted=true;video.playsInline=true;video.srcObject=stream;phase='play';await video.play();if(token!==generation)return;sourceWidth=video.videoWidth;sourceHeight=video.videoHeight;if(!sourceWidth||!sourceHeight)throw new DOMException('映像サイズが取得できません','NotReadableError');resetBackground();resize();lastFrame=0;lastMediaTime=-1;$('placeholder').hidden=true;$('stopCamera').disabled=false;$('cameraState').textContent='● CAMERA LIVE';stream.getVideoTracks()[0].onended=()=>stopCamera('カメラ接続が終了しました。もう一度起動してください。');$('captureBackground').disabled=false;warn('約1.5秒で背景を取得し、撮影範囲の上から落としてください。');schedule(token);}
  catch(e){if(token!==generation)return;stopCamera(cameraError(e,phase));}
};
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopCamera('画面が非表示になったためカメラを停止しました。戻ったら起動してください。');});
window.addEventListener('pagehide',()=>stopCamera());
// Both events are needed: older iOS exposes only window.orientationchange.
function rotated(){
  const active=stream || $('startCamera').disabled;
  if(active)stopCamera('画面回転により計測を中断しました。カメラを再起動し、背景を取得し直してください。');
  else resetBackground();
}
window.addEventListener('orientationchange',rotated);screen.orientation?.addEventListener('change',rotated);
video.addEventListener('error',()=>{if(stream)stopCamera('カメラ映像でエラーが発生しました。もう一度起動してください。');});
