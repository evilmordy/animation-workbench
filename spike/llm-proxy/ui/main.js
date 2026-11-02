const { invoke, Channel } = window.__TAURI__.core;
const report = {};
const log = (k, v) => {
  report[k] = v;
  document.getElementById('out').textContent += `${k}: ${JSON.stringify(v)}\n`;
};
const BASE = 'http://127.0.0.1:8766/v1';
const msgs = [{ role: 'user', content: 'hi' }];

async function chat(id, model, onEvent) {
  const ch = new Channel();
  ch.onmessage = onEvent;
  return invoke('llm_chat', { req: { request_id: id, provider_id: 'mock', model, messages: msgs, json_mode: true }, onEvent: ch });
}
const settle = (p) => p.then((v) => ({ ok: v }), (e) => ({ err: e }));

(async () => {
  log('rejectPlainHttp', await settle(invoke('secret_set', { providerId: 'x', baseUrl: 'http://api.openai.com/v1', apiKey: 'k' })));
  log('backend', await invoke('secret_set', { providerId: 'mock', baseUrl: BASE, apiKey: 'sk-test-123456' }));
  log('status', await invoke('secret_status', { providerId: 'mock' }));

  const events = [];
  const t0 = performance.now();
  const res = await settle(chat('r1', 'fast', (e) => events.push(e)));
  log('stream', { res, events, ms: Math.round(performance.now() - t0) });

  const slowEvents = [];
  let cancelAt = null;
  const slow = settle(chat('r2', 'slow', (e) => {
    slowEvents.push(e);
    if (slowEvents.length === 3) {
      cancelAt = performance.now();
      invoke('llm_cancel', { requestId: 'r2' });
    }
  }));
  const slowRes = await slow;
  log('cancel', { res: slowRes, eventsBeforeCancel: slowEvents.length, cancelLatencyMs: Math.round(performance.now() - cancelAt) });

  log('err429', await settle(chat('r3', 'err429', () => {})));
  log('noKey', await settle(invoke('llm_chat', { req: { request_id: 'r4', provider_id: 'none', model: 'fast', messages: msgs }, onEvent: new Channel() })));

  await invoke('secret_remove', { providerId: 'mock' });
  log('afterRemove', await invoke('secret_status', { providerId: 'mock' }));
})()
  .catch((e) => log('fatal', String(e)))
  .finally(() => setTimeout(() => invoke('probe_report', { report: JSON.stringify(report) }), 1500));
