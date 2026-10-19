// 共通教材と同じGASカウンター。カメラ・計測の操作イベントには接続しない。
(() => {
  if (window.paperCopterAccessRecorded) return;
  window.paperCopterAccessRecorded = true;
  try {
    fetch('https://script.google.com/macros/s/AKfycbxssCIHsD-N97SHxNC_GN0ihYeC0qy-lb-EY0KmSs6Gnztaph1sITMerLVEnNWOGkYc/exec?app=paper-copter-lab', {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      credentials: 'omit',
      keepalive: true,
    }).catch(() => {});
  } catch {
    // fetch未対応・同期例外も無視。再送・表示・ログ出力は行わない。
  }
})();
