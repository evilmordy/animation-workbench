window.__result = AwbSpike.run(document.getElementById('stage')).then(
  (r) => {
    window.__player = r.player;
    return { ...r, player: undefined };
  },
  (e) => ({ fatal: `${e.name}: ${e.message}` }),
);

// 在 iframe 里（Tauri 的 awpreview）时自测并把结果交给宿主
if (window.parent !== window) {
  window.__result.then(async (r) => {
    const caps = {
      isSecureContext: window.isSecureContext,
      VideoEncoder: typeof VideoEncoder,
      MediaRecorder: typeof MediaRecorder,
      OffscreenCanvas: typeof OffscreenCanvas,
      userAgent: navigator.userAgent,
    };
    let seekOk = null;
    let bench = null;
    if (!r.fatal) {
      const p = window.__player;
      seekOk = [(r.slides[2].start + r.slides[2].end) / 2, r.slides[0].start + 0.1, r.slides[1].end - 0.05].map((t) => {
        p.seek(t);
        return Math.abs(p.timeline.getCurrentTime() - t) < 1e-6;
      });
      p.seek(r.duration - 0.01);
      await new Promise((ok) => setTimeout(ok, 1500));
      bench = await AwbSpike.bench(document.createElement('div'), 3);
    }
    parent.postMessage({ type: 't02', result: r, seekOk, bench, caps }, '*');
  });
}
