// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import type { Storyboard } from '../../shared/schema';
import { playHtmlStoryboard } from './player';

function board(codes: { id: string; code: string; hold?: number }[]): Storyboard {
  return {
    schemaVersion: 1,
    meta: { title: 't', mode: '2d', aspect: '16:9', background: '#000000', stylePreset: '3b1b' },
    scenes: codes.map((scene) => ({
      id: scene.id,
      title: scene.id,
      description: '',
      kind: 'code' as const,
      enter: 'fresh' as const,
      hold: scene.hold ?? 0,
      elements: [],
      steps: [],
      code: scene.code,
    })),
  };
}

const box = (id: string, color: string) => `
const el = document.createElement('div');
el.id = ${JSON.stringify(id)};
el.textContent = ${JSON.stringify(id)};
el.style.position = 'absolute';
el.style.left = '80px';
el.style.top = '80px';
el.style.width = '200px';
el.style.height = '80px';
el.style.background = ${JSON.stringify(color)};
root.appendChild(el);
tl.add(el, { opacity: [0, 1], duration: 200 }, 0);
tl.add({ duration: 800 });
`;

afterEach(() => {
  document.body.replaceChildren();
});

describe('anime.js 播放', () => {
  it('seek 只改时间，下一场开始时上一场图层已经拿掉', async () => {
    const stage = document.createElement('div');
    stage.style.width = '960px';
    stage.style.height = '540px';
    document.body.appendChild(stage);
    const show = await playHtmlStoryboard(
      board([
        { id: 's1', code: box('s1', '#ff3366') },
        { id: 's2', code: box('s2', '#33cc88'), hold: 0.5 },
      ]),
      stage,
    );
    expect(show.errors).toEqual([]);
    expect(show.scenes.map((scene) => [scene.start, scene.end])).toEqual([
      [0, 1],
      [1, 2.5],
    ]);
    expect(show.duration).toBe(2.5);

    show.seek(1.4);
    expect(show.seek(1.4)).toBeUndefined();
    const second = document.getElementById('s2');
    const firstLayer = stage.querySelector('[data-scene="s1"]') as HTMLElement;
    const secondLayer = stage.querySelector('[data-scene="s2"]') as HTMLElement;
    expect(firstLayer.style.visibility).toBe('hidden');
    expect(secondLayer.style.visibility).not.toBe('hidden');
    expect(second?.textContent).toBe('s2');

    show.seek(0.5);
    expect(firstLayer.style.visibility).not.toBe('hidden');
    expect(secondLayer.style.visibility).toBe('hidden');
    show.kill();
  });

  it('坏代码只记在这一场，不让整片抛出去', async () => {
    const stage = document.createElement('div');
    document.body.appendChild(stage);
    const show = await playHtmlStoryboard(
      board([
        { id: 'bad', code: 'throw new Error("boom")' },
        { id: 'ok', code: box('ok', '#ffffff') },
      ]),
      stage,
    );
    expect(show.errors).toEqual([{ sceneId: 'bad', message: 'boom' }]);
    expect(show.scenes).toHaveLength(2);
    show.seek(1.5);
    expect((stage.querySelector('[data-scene="bad"]') as HTMLElement).style.visibility).toBe('hidden');
    show.kill();
  });
});
