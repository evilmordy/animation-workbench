import { build } from './runtime.js';

let player = null;

window.__ready = true;

window.__run = async (storyboard) => {
  const errors = [];
  const built = await build(storyboard, document.getElementById('stage'), {
    controls: false,
    onError: (e) => errors.push(e),
  });
  player = built.player;
  player.pause();
  return {
    duration: built.duration,
    scenes: built.scenes,
    errors,
    buildMs: built.buildMs,
  };
};

window.__seek = (t) => player?.seek(t);
window.__play = () => player?.play();
window.__pause = () => player?.pause();
window.__objects = () => {
  const set = player?.scene?.mobjects;
  if (!set) return [];
  return [...set].map((m) => ({
    tag: typeof m.awbTag === 'string' ? m.awbTag : '',
    opacity: m.opacity,
  }));
};
