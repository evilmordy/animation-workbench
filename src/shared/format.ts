/** 秒 → m:ss.s */
export function formatTime(t: number): string {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const rest = (s - m * 60).toFixed(1).padStart(4, '0');
  return `${m}:${rest}`;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
