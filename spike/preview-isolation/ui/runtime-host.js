const { invoke, convertFileSrc } = window.__TAURI__.core;

const iframe = document.createElement('iframe');
iframe.setAttribute('sandbox', 'allow-scripts');
iframe.src = convertFileSrc('runtime.html', 'awpreview');
iframe.style.cssText = 'width:820px;height:470px;border:0';
const t0 = performance.now();

window.addEventListener('message', (e) => {
  if (e.source !== iframe.contentWindow || e.data?.type !== 't02') return;
  const host = { isSecureContext: window.isSecureContext, VideoEncoder: typeof VideoEncoder };
  const report = { ...e.data, host, totalMs: Math.round(performance.now() - t0) };
  // 留几秒给外部截图
  setTimeout(() => invoke('probe_report', { report: JSON.stringify(report) }), 4000);
});
document.getElementById('frame').append(iframe);
setTimeout(() => invoke('probe_report', { report: JSON.stringify({ timeout: true }) }), 60000);
