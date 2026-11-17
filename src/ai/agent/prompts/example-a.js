// 出处：awb-s8c/hand-anime/mergesort/m_cx.js（整场）
// 改动：无语义改动。按仓库 prettier 折行。
head('为什么是 O(n log n)', 0);
const rows = [2, 4, 8];
const parts = [];
rows.forEach((cnt, L) => {
  const y = 220 + L * 150,
    w = 900 / cnt;
  const segs = [];
  for (let g = 0; g < cnt; g++)
    segs.push(
      el(
        'div',
        {
          left: 460 + g * w,
          top: y,
          width: w - 12,
          height: 84,
          border: '3px solid ' + C.blue,
          background: 'rgba(88,196,221,0.2)',
          borderRadius: 8,
          boxSizing: 'border-box',
          color: C.soft,
          fontSize: 28,
          lineHeight: '78px',
          textAlign: 'center',
        },
        `${8 / cnt} 个`,
      ),
    );
  const lab = txt(`合并 ${cnt / 2} 次 → 共约 n 次比较`, 1420, y + 22, 32, C.text);
  parts.push([segs, lab]);
});
const brace = el('div', {
  left: 400,
  top: 220,
  width: 30,
  height: 384,
  borderLeft: '4px solid ' + C.orange,
  borderTop: '4px solid ' + C.orange,
  borderBottom: '4px solid ' + C.orange,
  borderRadius: '14px 0 0 14px',
  boxSizing: 'border-box',
});
const bl = txt('log₂8 = 3 层', 150, 390, 34, C.orange);
say('每一层，所有段加起来总共 n 个元素', 300);
for (const [segs, lab] of parts) {
  fadeIn(segs, '+=0', { scaleX: [0, 1], delay: anime.stagger(80), duration: 400 });
  rise(lab, '+=0', { x: [20, 0], y: [0, 0] });
  wait(700);
}
say('合并一层只需把每个元素放一次：每层 O(n)', '+=0');
wait(1600);
fadeIn(brace, '+=0', { scaleY: [0, 1] });
fadeIn(bl, '+=0');
say('每次对半拆，n 个数要拆 log₂ n 层', '<<');
wait(1800);
const f1 = ctext('每层 O(n) &nbsp;×&nbsp; log n 层', 690, 46, C.text);
const f2 = ctext('= O(n log n)', 770, 66, C.orange, { fontWeight: 700 });
rise(f1, '+=0', { duration: 600 });
wait(600);
fadeIn(f2, '+=0', { scale: [0.6, 1], duration: 700, ease: 'outBack(2)' });
say('总工作量 O(n log n)；最好、最坏、平均都一样', '<<', C.orange);
wait(2800);
