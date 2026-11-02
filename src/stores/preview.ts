import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import type { HostMessage, SceneSpan } from '../shared/protocol';

export interface PreviewError {
  sceneId?: string;
  elementId?: string;
  message: string;
}

/** 预览 iframe 的状态；发送消息由 PreviewPane 注册的 sender 完成 */
export const usePreviewStore = defineStore('preview', () => {
  const ready = ref(false);
  const stalled = ref(false);
  const time = ref(0);
  const playing = ref(false);
  const duration = ref(0);
  const rate = ref(1);
  const spans = shallowRef<SceneSpan[]>([]);
  const errors = shallowRef<PreviewError[]>([]);
  const buildMs = ref(0);
  const runtimeVersion = ref('');
  let sender: ((m: HostMessage) => void) | null = null;

  const send = (m: HostMessage) => sender?.(m);
  const setSender = (fn: typeof sender) => (sender = fn);

  return {
    ready,
    stalled,
    time,
    playing,
    duration,
    rate,
    spans,
    errors,
    buildMs,
    runtimeVersion,
    setSender,
    play: () => send({ type: 'play' }),
    pause: () => send({ type: 'pause' }),
    toggle: () => send({ type: playing.value ? 'pause' : 'play' }),
    seek: (t: number) => {
      time.value = Math.max(0, Math.min(t, duration.value));
      send({ type: 'seek', t: time.value });
    },
    setRate: (r: number) => {
      rate.value = r;
      send({ type: 'setRate', rate: r });
    },
  };
});
