/**
 * 有些 PDF 的字体映射把汉字指向了"部首"码位（如 ⻆ U+2EC6、⽅ U+2F45），看起来一样但搜索、
 * AI 理解都会出错。只修这两个区，不做整体 NFKC（那会把 ² 变成 2、全角标点变成半角）。
 */
const SUPPLEMENT: Record<string, string> = {
  '\u2E9F': '母',
  '\u2EA0': '民',
  '\u2EC1': '虎',
  '\u2EC4': '西',
  '\u2EC5': '见',
  '\u2EC6': '角',
  '\u2EC8': '讠',
  '\u2EC9': '贝',
  '\u2ECA': '足',
  '\u2ECB': '车',
  '\u2ED3': '长',
  '\u2ED4': '门',
  '\u2ED7': '雨',
  '\u2ED8': '青',
  '\u2ED9': '韦',
  '\u2EDA': '页',
  '\u2EDB': '风',
  '\u2EDC': '飞',
  '\u2EDD': '食',
  '\u2EE2': '马',
  '\u2EE3': '骨',
  '\u2EE4': '鬼',
  '\u2EE5': '鱼',
  '\u2EE6': '鸟',
  '\u2EE7': '卤',
  '\u2EE8': '麦',
  '\u2EE9': '黄',
  '\u2EEC': '齐',
  '\u2EEE': '齿',
  '\u2EF0': '龙',
  '\u2EF3': '龟',
};

export function fixCjkRadicals(text: string): string {
  return text
    .replace(/[\u2F00-\u2FD5]/g, (c) => c.normalize('NFKC'))
    .replace(/[\u2E80-\u2EFF]/g, (c) => SUPPLEMENT[c] ?? c);
}
