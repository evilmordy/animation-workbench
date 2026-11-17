// 出处：awb-s8c/hand-anime/psych/p_why.js（整场）
// 改动：补 const WARM。原色值在 psych/shared.js，范例不带 shared。其余无语义改动，按 prettier 折行。
const WARM = '#ffb454';
head('解释：任务会在心里留下一股「张力」', 0);
const lab = txt('心理张力', 230, 210, 36, C.soft);
const frame = el('div', {
  left: 420,
  top: 204,
  width: 1100,
  height: 56,
  border: '3px solid ' + C.dim,
  borderRadius: 28,
  boxSizing: 'border-box',
  overflow: 'hidden',
});
const fill = el(
  'div',
  { left: 0, top: 0, width: 40, height: 50, background: WARM, borderRadius: 25 },
  null,
  frame,
);
const s1 = ctext('开始一个任务 → 张力升起', 350, 40, C.text);
const s2 = ctext('做完 → 张力释放，记忆可以放下', 440, 40, C.green);
const s3 = ctext('被打断 → 张力一直挂着，念头反复冒出来', 530, 40, WARM);
fadeIn([lab, frame], 300);
rise(s1, '+=0');
tw(fill, { width: [40, 1000], duration: 1200, ease: 'inQuad' }, '+=0');
say('开始做一件事，心里就形成一个「要完成它」的目标', '<<');
wait(1200);
rise(s2, '+=0');
tw(fill, { width: 40, backgroundColor: C.green, duration: 1200 }, '+=0');
say('做完了，目标达成，张力释放，大脑就不必再惦记', '<<', C.green);
wait(1200);
rise(s3, '+=0');
tw(fill, { width: 1000, backgroundColor: WARM, duration: 1200 }, '+=0');
tw(frame, { x: [0, 8, -8, 8, -8, 6, -6, 0], duration: 600, ease: 'linear' }, '+=0');
say('被打断：目标悬而未决，它会不断把相关信息拉回注意力', '<<', WARM);
wait(1200);
const n = ctext('勒温「场论」：未完成的目标保持着一个紧张系统，让相关记忆更易被提取', 680, 34, C.text);
rise(n, '+=0');
wait(3000);
