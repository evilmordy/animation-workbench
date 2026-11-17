head('为什么是 O(n log n)', 0);
const rows = [2, 4, 8];
const layers = rows.map((cnt, level) => {
  const width = 720 / cnt;
  const bars = [];
  for (let i = 0; i < cnt; i++) {
    bars.push(
      el(
        'div',
        {
          left: 140 + i * width,
          top: 180 + level * 110,
          width: width - 12,
          height: 56,
          background: C.blue,
        },
        '',
      ),
    );
  }
  const note = txt(level === 0 ? '2 段' : level === 1 ? '4 段' : '8 段', 980, 190 + level * 110, 32, C.text);
  return { bars, note };
});
say('每一层，所有段加起来总共 n 个元素', 400);
layers.forEach((layer, level) => {
  fadeIn(layer.bars, 900 + level * 1100);
  rise(layer.note, '+=0');
  wait(600);
});
const formula = ctext('= O(n log n)', 760, 48, C.orange, { fontWeight: 700 });
fadeIn(formula, '+=0', { scale: [0.6, 1], duration: 700 });
say('总工作量 O(n log n)；最好、最坏、平均都一样', '<<', C.orange);
wait(1200);
