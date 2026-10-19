// Shared geometry for CSS object-fit: contain, drawing, and pointer hit testing.
export function containRect(width, height, sourceWidth, sourceHeight) {
  if (![width,height,sourceWidth,sourceHeight].every(v=>Number.isFinite(v)&&v>0)) return null;
  const scale=Math.min(width/sourceWidth,height/sourceHeight);
  const w=sourceWidth*scale,h=sourceHeight*scale;
  return {x:(width-w)/2,y:(height-h)/2,w,h};
}
export function imagePoint(rect,x,y) {
  if(!rect || x<rect.x || x>rect.x+rect.w || y<rect.y || y>rect.y+rect.h)return null;
  return {x:(x-rect.x)/rect.w,y:(y-rect.y)/rect.h};
}
export function analysisSize(width,height) {
  const scale=320/Math.max(width,height);
  return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}
export function cameraError(error,phase='capture') {
  const messages={
    NotAllowedError:'カメラの使用が許可されませんでした。サイトのカメラ許可、端末の利用制限、HTTPSで直接開いているかを確認してください。',
    NotFoundError:'カメラが見つかりません。接続を確認してください。',
    NotReadableError:'カメラを開けません。他のアプリでの使用や端末側の問題を確認してください。',
    OverconstrainedError:'このカメラは要求した撮影設定に対応していません。',
    SecurityError:'ブラウザのセキュリティ設定でカメラが無効です。',
    AbortError:'カメラの起動が中断されました。もう一度起動してください。',
    InvalidStateError:'ページが使用可能な状態ではありません。SafariまたはChromeでページを開き直してください。'
  };
  const name=error?.name||'UnknownError';
  const text=phase==='play'?'カメラ映像を再生できません。SafariまたはChromeで直接開き、もう一度起動してください。':messages[name]||'カメラの起動に失敗しました。ブラウザを再起動してお試しください。';
  return `${text}（${name}）`;
}
