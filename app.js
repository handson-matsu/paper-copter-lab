import {detectRed,FallTimer,csvCell,createDetectionWorkspace} from './tracker.js';
import {containRect,imagePoint,analysisSize,cameraError} from './camera-utils.js';
const detectionWorkspace=createDetectionWorkspace();
const $=id=>document.getElementById(id), video=$('video'), overlay=$('overlay'), ctx=overlay.getContext('2d');
const analysis=document.createElement('canvas'), ax=analysis.getContext('2d',{willReadFrequently:true});
let sourceWidth=0,sourceHeight=0,analysisMs=0;
let stream=null,callback=null,usingVideoFrames=false,previous=null,lastSeen=0,lastFrame=0,lastMediaTime=-1,fps=0,floor=.85,floorSet=false,settingFloor=false,timer=new FallTimer(),snapshot={},records=[],savedConditions={},generation=0;
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
    let td=cell();td.textContent=new Date(r.date).toLocaleString('ja-JP');let small=document.createElement('small');small.textContent=r.conditions.experiment||'名称未設定';td.append(small);
    td=cell();td.textContent=r.conditions.group||'グループ未設定';small=document.createElement('small');small.textContent=Object.entries(labels).filter(([k])=>!['experiment','group'].includes(k)).map(([k,label])=>`${label}: ${r.conditions[k]||'—'}`).join(' / ');td.append(small);
    td=cell();const strong=document.createElement('strong');strong.textContent=r.seconds.toFixed(3);td.append(strong,' 秒');
    td=cell();td.textContent=r.status;small=document.createElement('small');small.textContent=r.flags.join(' / ');td.append(small);
    td=cell();if(r.status==='確認待ち'){const b=document.createElement('button');b.textContent='確認して確定';b.onclick=()=>{r.status='手動確認済み';store('copter.records',records);renderRecords();};td.append(b);}
    const del=document.createElement('button');del.textContent='削除';del.onclick=()=>{if(confirm(`${r.seconds.toFixed(3)}秒の記録を削除しますか？`)){records=records.filter(x=>x.id!==r.id);store('copter.records',records);renderRecords();}};td.append(del);$('history').append(tr);
  }
}
renderRecords();
$('export').onclick=()=>{const keys=Object.keys(labels),rows=[['測定日時',...Object.values(labels),'落下時間(秒)','状態','確認理由','開始時刻(ms・ページ基準)','終了時刻(ms・ページ基準)','判定設定'],...records.map(r=>[r.date,...keys.map(k=>r.conditions[k]),r.seconds.toFixed(3),r.status,r.flags.join(' / '),r.start,r.end,JSON.stringify(r.config)])];const blob=new Blob(['\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`paper-copter-${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
function prepare(){const config={floor};for(const id of ['startSpeed','startMs','stopSpeed','settleMs']){const el=$(id);if(!el.checkValidity()){el.reportValidity();return false;}config[id]=Number(el.value);}timer=new FallTimer(config);previous=null;lastSeen=0;snapshot=conditions();$('time').textContent='0.000';$('state').textContent='待機中';$('resultNotice').textContent='';$('next').disabled=true;return true;}
$('next').onclick=()=>{if(prepare()){$('state').textContent='次の測定待機';warn('マーカーを上へ戻して静止させ、そのまま落としてください。');}};
$('sensitivity').oninput=()=>{$('sensitivityValue').textContent=$('sensitivity').value;timer.flag('検出感度を計測途中で変更');};
$('debugToggle').onchange=()=>{$('debug').hidden=!$('debugToggle').checked;};
$('setFloor').onclick=()=>{if(!stream){warn('カメラを起動してから床を指定してください。');return;}if(timer.start!==null&&!timer.result){warn('計測中は床を変更できません。');return;}settingFloor=true;warn('映像内の床に着地したマーカー中心の高さをタップしてください。');};
function videoRect(){return containRect(overlay.width,overlay.height,video.videoWidth,video.videoHeight);}
function invalidateFloor(message='カメラ起動後：床を指定し直してください'){
  floorSet=false;settingFloor=false;$('floorInfo').textContent=message;
}
overlay.onclick=e=>{
  if(!settingFloor||!video.videoWidth)return;
  const b=overlay.getBoundingClientRect();
  const point=imagePoint(videoRect(),(e.clientX-b.left)*overlay.width/b.width,(e.clientY-b.top)*overlay.height/b.height);
  if(!point){warn('余白ではなく、カメラ映像内の床をタップしてください。');return;}
  if(point.y<.15||point.y>.98){warn('床は映像の高さ15〜98%の範囲で指定してください。');return;}
  floor=point.y;floorSet=true;settingFloor=false;
  $('floorInfo').textContent=`床：画面の${Math.round(floor*100)}%（指定済み）`;
  prepare();warn('床を設定しました。上でマーカーを静止させてから落としてください。');
};
function resize(){
  const b=overlay.getBoundingClientRect();if(!b.width||!b.height)return;
  const scale=Math.min(devicePixelRatio||1,2,1920/Math.max(b.width,b.height));
  const w=Math.round(b.width*scale),h=Math.round(b.height*scale);
  if(overlay.width!==w||overlay.height!==h){overlay.width=w;overlay.height=h;}
}
new ResizeObserver(resize).observe($('stage'));
function saveResult(result){if(!floorSet)result.flags.push('床位置が仮設定');if(result.seconds<.2)result.flags.push('落下時間が短すぎる');if(result.flags.length)result.status='確認待ち';const record={...result,id:crypto.randomUUID(),date:new Date().toISOString(),conditions:{...snapshot},config:{...timer.config,sensitivity:Number($('sensitivity').value)}};records.unshift(record);const ok=store('copter.records',records);renderRecords();$('time').textContent=result.seconds.toFixed(3);$('next').disabled=false;$('resultNotice').textContent=`${ok?'自動保存しました':'保存失敗・CSVを書き出してください'}。${result.status==='確認待ち'?'測定結果で確認してください。':'次の測定に進めます。'}`;}
function schedule(token){if(token!==generation||!stream)return;usingVideoFrames=typeof video.requestVideoFrameCallback==='function';callback=usingVideoFrames?video.requestVideoFrameCallback(t=>frame(t,token)):requestAnimationFrame(t=>frame(t,token));}
function frame(t,token){if(token!==generation||!stream)return;
  try {
  if(video.readyState>=2 && video.videoWidth && video.videoHeight){
    if(sourceWidth!==video.videoWidth || sourceHeight!==video.videoHeight){
      stopCamera('カメラ映像の縦横サイズが変化しました。再起動し、床を指定し直してください。');return;
    }
    // A lower rate reduces heat and garbage collection on mobile devices.
    if(lastFrame && t-lastFrame<1000/30){schedule(token);return;}
    const processingStart=performance.now();
    if(!usingVideoFrames && video.currentTime===lastMediaTime){schedule(token);return;}
    lastMediaTime=video.currentTime;
    const interval=t-lastFrame;fps=interval>0?1000/interval:0;lastFrame=t;
    const {width:w,height:h}=analysisSize(video.videoWidth,video.videoHeight);if(analysis.width!==w||analysis.height!==h){analysis.width=w;analysis.height=h;}
    ax.drawImage(video,0,0,w,h);if(t-lastSeen>500)previous=null;
    const detection=detectRed(ax.getImageData(0,0,w,h).data,w,h,Number($('sensitivity').value),previous,detectionWorkspace);
    if(detection.point){previous=detection.point;lastSeen=t;}
    const beforeStart=timer.start;
    const result=timer.update(detection.point,t,detection.ambiguous);
    if(beforeStart===null && timer.start!==null)snapshot=conditions();
    if(result)saveResult(result);
    $('state').textContent=timer.state;$('detection').textContent=detection.point?(detection.ambiguous?'複数候補・確認が必要':'マーカー検出中'):'マーカーを見失っています';
    if(timer.start!==null&&!timer.result)$('time').textContent=((t-timer.start)/1000).toFixed(3);
    ctx.clearRect(0,0,overlay.width,overlay.height);const r=videoRect();if(!r){schedule(token);return;}
    const drawScale=overlay.width/Math.max(1,overlay.getBoundingClientRect().width);
    ctx.strokeStyle='#f6c969';ctx.lineWidth=2*drawScale;ctx.setLineDash([8*drawScale,5*drawScale]);ctx.beginPath();ctx.moveTo(r.x,r.y+floor*r.h);ctx.lineTo(r.x+r.w,r.y+floor*r.h);ctx.stroke();ctx.setLineDash([]);
    if(detection.point){ctx.strokeStyle='#69f2a3';ctx.lineWidth=3*drawScale;ctx.beginPath();ctx.arc(r.x+detection.point.x*r.w,r.y+detection.point.y*r.h,15*drawScale,0,Math.PI*2);ctx.stroke();}
    analysisMs=performance.now()-processingStart;
    if($('debugToggle').checked)$('debug').textContent=`座標（正規化）: ${detection.point?`${detection.point.x.toFixed(3)}, ${detection.point.y.toFixed(3)}`:'—'}\n検出面積: ${detection.point?.area??0} px（解析 ${w}×${h}）\n検出状態: ${$('detection').textContent}\n縦速度: ${timer.speed.toFixed(3)} 画面高/秒\n開始時刻: ${timer.start??'—'} ms\n終了時刻: ${timer.end??'—'} ms\nフレーム処理: ${fps.toFixed(1)} fps\n解析時間: ${analysisMs.toFixed(1)} ms\n検出失敗・不確実理由: ${detection.reason||'なし'}\n計測の確認理由: ${[...timer.flags].join(' / ')||'なし'}`;
  }
  } catch(error){stopCamera(`映像の解析を継続できません（${error.name}）。カメラを再起動してください。`);return;}
  schedule(token);
}
function stopCamera(reason='カメラを停止しました。再起動できます。'){
  generation++;if(callback!==null){if(usingVideoFrames)video.cancelVideoFrameCallback(callback);else cancelAnimationFrame(callback);}callback=null;
  if(timer.start!==null&&!timer.result)saveResult(timer.finish(timer.last?.t??performance.now(),'カメラ停止／計測中断'));
  if(stream)for(const track of stream.getTracks()){track.onended=null;track.stop();}stream=null;video.pause();video.srcObject=null;sourceWidth=0;sourceHeight=0;invalidateFloor();ctx.clearRect(0,0,overlay.width,overlay.height);$('placeholder').hidden=false;$('startCamera').disabled=false;$('stopCamera').disabled=true;$('cameraState').textContent='CAMERA OFF';$('detection').textContent='カメラ停止中';warn(reason);
}
$('stopCamera').onclick=()=>stopCamera();
$('startCamera').onclick=async()=>{
  if(!window.isSecureContext){warn('カメラにはHTTPSが必要です。GitHub PagesのHTTPS URL、またはlocalhostで開いてください。');return;}
  if(!navigator.mediaDevices?.getUserMedia){warn('このブラウザではカメラAPIを利用できません。SafariまたはChromeで直接開いてください。');return;}
  if(!prepare())return;$('startCamera').disabled=true;$('stopCamera').disabled=false;warn('カメラの許可・起動を待っています。取り消す場合は停止を押してください。');const token=++generation;let phase='capture';
  try{const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30}},audio:false});if(token!==generation){media.getTracks().forEach(t=>t.stop());return;}stream=media;video.muted=true;video.playsInline=true;video.srcObject=stream;phase='play';await video.play();if(token!==generation)return;sourceWidth=video.videoWidth;sourceHeight=video.videoHeight;if(!sourceWidth||!sourceHeight)throw new DOMException('映像サイズが取得できません','NotReadableError');invalidateFloor();resize();lastFrame=0;lastMediaTime=-1;$('placeholder').hidden=true;$('stopCamera').disabled=false;$('cameraState').textContent='● CAMERA LIVE';stream.getVideoTracks()[0].onended=()=>stopCamera('カメラ接続が終了しました。もう一度起動してください。');warn('カメラ起動中。床を指定し、マーカーを上で静止させてから落としてください。');schedule(token);}
  catch(e){if(token!==generation)return;stopCamera(cameraError(e,phase));}
};
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopCamera('画面が非表示になったためカメラを停止しました。戻ったら起動してください。');});
window.addEventListener('pagehide',()=>stopCamera());
// Both events are needed: older iOS exposes only window.orientationchange.
function rotated(){
  const active=stream || $('startCamera').disabled;
  if(active)stopCamera('画面回転により計測を中断しました。カメラを再起動し、床を指定し直してください。');
  invalidateFloor('画面回転後：床を指定し直してください');
}
window.addEventListener('orientationchange',rotated);screen.orientation?.addEventListener('change',rotated);
video.addEventListener('error',()=>{if(stream)stopCamera('カメラ映像でエラーが発生しました。もう一度起動してください。');});
