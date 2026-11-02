const { invoke, convertFileSrc } = window.__TAURI__.core;
const out = document.getElementById('out');
const results = [];
let finished = false;

const iframe = document.createElement('iframe');
iframe.setAttribute('sandbox', 'allow-scripts');
iframe.src = convertFileSrc('index.html', 'awpreview');
iframe.style.cssText = 'width:600px;height:150px;background:#fff';

async function finish(reason) {
  if (finished) return;
  finished = true;
  await invoke('probe_report', { report: JSON.stringify({ reason, iframeSrc: iframe.src, results }) });
}

window.addEventListener('message', (e) => {
  if (e.source !== iframe.contentWindow) return;
  const m = e.data;
  if (m && m.type === 'probe') {
    results.push(m);
    out.textContent += `${m.name}: ${m.outcome} ${m.detail}\n`;
  } else if (m && m.type === 'done') {
    // 留时间给 iframe 自导航探针打到测试服务器
    setTimeout(() => finish('done'), 3000);
  }
});

(async () => {
  // 正对照：证明 canary 机制本身能被记录
  await invoke('sec_canary', { source: 'host-control' });
  document.getElementById('frame').append(iframe);
  setTimeout(() => finish('timeout'), 20000);
})();
