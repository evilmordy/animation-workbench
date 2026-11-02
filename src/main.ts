import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';

const pinia = createPinia();
createApp(App).use(pinia).mount('#app');

// debug 构建的真实环境自检（由 Rust 在 AWB_SELFTEST=1 时触发）
const selftest = () => void import('./selftest').then((m) => m.runSelftest(pinia));
if ((window as { __AWB_SELFTEST__?: boolean }).__AWB_SELFTEST__) selftest();
else window.addEventListener('awb-selftest', selftest, { once: true });
