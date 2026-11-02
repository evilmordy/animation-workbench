import { beforeEach, describe, expect, it } from 'vitest';
import { mockDialogs, mockPlatform as p, resetMockFs, setMockLlm } from './mock';

beforeEach(resetMockFs);

describe('mock 平台', () => {
  it('文件读写、目录列举、删除', async () => {
    const dir = await p.pickDirectory('x');
    expect(dir).toMatch(/^\/projects\//);
    await p.mkdir(`${dir}/versions`);
    await p.writeTextAtomic(`${dir}/storyboard.json`, '{}');
    await p.writeBinary(`${dir}/a.bin`, new Uint8Array([1, 2]));
    expect((await p.readDir(dir!)).sort()).toEqual(['a.bin', 'storyboard.json', 'versions']);
    expect(await p.readText(`${dir}/storyboard.json`)).toBe('{}');
    expect([...(await p.readBinary(`${dir}/a.bin`))]).toEqual([1, 2]);
    await p.remove(`${dir}/versions`);
    expect(await p.exists(`${dir}/versions`)).toBe(false);
    await expect(p.readText(`${dir}/nope.json`)).rejects.toThrow('文件不存在');
  });

  it('父目录不存在时写入失败', async () => {
    await expect(p.writeTextAtomic('/nowhere/x.json', '1')).rejects.toThrow('目录不存在');
  });

  it('对话框返回值可预设', async () => {
    mockDialogs.nextDirectory = '/projects/指定';
    expect(await p.pickDirectory('x')).toBe('/projects/指定');
    expect(await p.pickFile('x', [])).toBeNull();
  });

  it('密钥只返回末 4 位', async () => {
    await p.secretSet('deepseek', 'https://api.deepseek.com', 'sk-abcdef1234');
    expect(await p.secretStatus('deepseek')).toEqual({
      exists: true,
      base_url: 'https://api.deepseek.com',
      last4: '1234',
      backend: 'memory',
    });
  });

  it('假 LLM 流式输出，可取消', async () => {
    setMockLlm(async (_req, emit) => {
      for (const t of ['a', 'b', 'c']) await emit(t);
      return 'abc';
    });
    const events: string[] = [];
    const req = { request_id: 'r1', provider_id: 'x', model: 'm', messages: [], json_mode: false };
    const r = await p.llmChat(req, (e) => events.push(e.type));
    expect(r.text).toBe('abc');
    expect(events).toEqual(['Delta', 'Delta', 'Delta', 'Usage', 'Done']);

    const pending = p.llmChat({ ...req, request_id: 'r2' }, () => {});
    await p.llmCancel('r2');
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  });
});
