import { build, runtimeFlags } from './runtime.js';

let player = null;

window.__ready = true;

/** enable 省略时保持包内默认（false）。 */
window.__run = async (storyboard, enable) => {
  if (enable !== undefined) runtimeFlags.codeScenes = !!enable;
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
