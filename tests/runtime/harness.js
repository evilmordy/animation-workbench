// 模拟宿主：只接受来自预览 iframe 的消息，记录下来供测试读取
const frame = document.getElementById('preview');
window.__msgs = [];
window.addEventListener('message', (e) => {
  if (e.source === frame.contentWindow) window.__msgs.push(e.data);
});
window.send = (msg) => frame.contentWindow.postMessage(msg, '*');
