const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** 生成形如 `s_k3x9q2` 的 id；传入 taken 时保证不与已有 id 重复 */
export function newId(prefix: string, taken?: ReadonlySet<string>): string {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    const id = `${prefix}_${Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')}`;
    if (!taken?.has(id)) return id;
  }
}
