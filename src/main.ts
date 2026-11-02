import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { platform } from './platform';

const pinia = createPinia();

// 浏览器模式没有真实的 LLM，用基于示例的假回答走通 AI 流程
if (platform.kind === 'mock') {
  void Promise.all([import('./ai/mockLlm'), import('./platform/mock')]).then(([a, m]) =>
    m.setMockLlm(a.mockLlm),
  );
}
createApp(App).use(pinia).mount('#app');

// debug 构建的真实环境自检（由 Rust 在 AWB_SELFTEST=1 时触发）
const selftest = () => void import('./selftest').then((m) => m.runSelftest(pinia));
if ((window as { __AWB_SELFTEST__?: boolean }).__AWB_SELFTEST__) selftest();
else window.addEventListener('awb-selftest', selftest, { once: true });
