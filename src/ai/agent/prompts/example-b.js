head('未完成的更容易记住', 0);
const done = el(
  'div',
  {
    left: 180,
    top: 240,
    width: 720,
    height: 120,
    background: C.teal,
    color: C.bg,
    fontSize: 36,
  },
  '已完成的任务',
);
const open = el(
  'div',
  {
    left: 180,
    top: 420,
    width: 720,
    height: 120,
    background: C.orange,
    color: C.bg,
    fontSize: 36,
  },
  '未完成的任务',
);
fadeIn(done, 500);
say('做完的很快淡出记忆', 500);
wait(900);
fadeIn(open, '+=0');
say('没做完的停在眼前', '<<');
wait(1400);
