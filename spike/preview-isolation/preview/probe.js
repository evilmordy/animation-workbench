// 在 sandbox iframe 内运行。outcome 只表示"没抛异常"，是否真的越界以 canary 日志和测试服务器日志为准。
const SRV = 'http://127.0.0.1:8765';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = (name, outcome, detail) =>
  parent.postMessage({ type: 'probe', name, outcome, detail: String(detail ?? '') }, '*');
const errText = (e) => (e && e.name ? `${e.name}: ${e.message}` : String(e));

async function probe(name, fn) {
  try {
    report(name, 'no-throw', await fn());
  } catch (e) {
    report(name, 'threw', errText(e));
  }
}

// 格式与 Tauri 自己发的完全一致，只有 invoke key 是猜的：iframe 拿不到真 key
const tauriMsg = (source) =>
  JSON.stringify({
    cmd: 'sec_canary', callback: 1, error: 2, payload: { source }, options: {},
    __TAURI_INVOKE_KEY__: 'forged-by-iframe',
  });

const ipcFetch = (url, source) =>
  fetch(url, {
    method: 'POST',
    body: JSON.stringify({ source }),
    headers: {
      'Content-Type': 'application/json', 'Tauri-Callback': '1', 'Tauri-Error': '2',
      'Tauri-Invoke-Key': 'forged-by-iframe',
    },
  }).then((r) => `status ${r.status}`);

// 等待资源加载结果，超时视为未发出或被静默拦截
const waitEvents = (el, ms = 1500) =>
  new Promise((resolve) => {
    el.onload = () => resolve('load');
    el.onerror = () => resolve('error');
    setTimeout(() => resolve('timeout'), ms);
  });

(async () => {
  await probe('control-eval', () => eval('1+1'));
  await probe('origin', () => `${location.href} origin=${self.origin}`);

  await probe('window.__TAURI_INTERNALS__', async () => {
    const t = window.__TAURI_INTERNALS__;
    if (!t) return `typeof=${typeof t}`;
    return `PRESENT; invoke -> ${await t.invoke('sec_canary', { source: 'iframe-own-internals' })}`;
  });
  await probe('parent.__TAURI_INTERNALS__', async () => {
    const t = parent.__TAURI_INTERNALS__;
    if (!t) return `typeof=${typeof t}`;
    return `PRESENT; invoke -> ${await t.invoke('sec_canary', { source: 'iframe-parent-internals' })}`;
  });
  await probe('window.ipc.postMessage', () => {
    if (!window.ipc) return 'window.ipc undefined';
    window.ipc.postMessage(tauriMsg('iframe-window-ipc'));
    return 'SENT';
  });
  await probe('webkit.messageHandlers.ipc', () => {
    const h = window.webkit?.messageHandlers?.ipc;
    if (!h) return 'handler undefined';
    h.postMessage(tauriMsg('iframe-webkit-mh'));
    return 'SENT';
  });
  await probe('chrome.webview.postMessage', () => {
    const w = window.chrome?.webview;
    if (!w) return 'chrome.webview undefined';
    w.postMessage(tauriMsg('iframe-chrome-webview'));
    return 'SENT';
  });
  await probe('fetch ipc://localhost', () => ipcFetch('ipc://localhost/sec_canary', 'iframe-fetch-ipc-scheme'));
  await probe('fetch http://ipc.localhost', () => ipcFetch('http://ipc.localhost/sec_canary', 'iframe-fetch-ipc-http'));

  await probe('net fetch', () => fetch(`${SRV}/fetch`).then((r) => `status ${r.status}`));
  await probe('net xhr', () =>
    new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('GET', `${SRV}/xhr`);
      x.onload = () => resolve(`status ${x.status}`);
      x.onerror = () => reject(new Error('xhr onerror'));
      x.send();
    }),
  );
  await probe('net websocket', () =>
    new Promise((resolve) => {
      const ws = new WebSocket('ws://127.0.0.1:8765/ws');
      ws.onopen = () => resolve('open');
      ws.onerror = () => resolve('error');
      setTimeout(() => resolve('timeout'), 1500);
    }),
  );
  await probe('net image', () => {
    const img = new Image();
    const p = waitEvents(img);
    img.src = `${SRV}/img`;
    return p;
  });
  await probe('net css url()', async () => {
    const s = document.createElement('style');
    s.textContent = `body{background-image:url(${SRV}/css)}`;
    document.head.append(s);
    await sleep(1000);
    return 'injected';
  });
  await probe('net sendBeacon', () => navigator.sendBeacon(`${SRV}/beacon`, 'x'));

  parent.postMessage({ type: 'done' }, '*');
  await sleep(200);
  location.href = `${SRV}/nav`;
})();
