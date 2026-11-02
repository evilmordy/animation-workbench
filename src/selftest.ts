import type { Pinia } from 'pinia';
import { platform } from './platform';
import { newId } from './shared/id';
import { useProjectStore } from './stores/project';
import { usePreviewStore } from './stores/preview';

/**
 * 真实 Tauri 环境自检（debug 构建，AWB_SELFTEST=basic|stress 启动），结果打印到终端。
 * AWB_SELFTEST_LLM 指向本地 mock LLM（spike/llm-proxy/mock_llm.py）时，额外检查 Key 和 LLM 代理。
 */

type Check = { name: string; ok: boolean; detail?: string };
export interface SelftestConfig {
  mode: 'basic' | 'stress';
  llm?: string | null;
}

const MOCK_KEY = 'sk-test-123456';

const until = async (cond: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
  return true;
};

const rejects = async (p: Promise<unknown>) =>
  p.then(
    () => false,
    () => true,
  );

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of await platform.readDir(dir)) {
    const p = await platform.join(dir, name);
    try {
      await platform.readDir(p);
      out.push(...(await listFiles(p)));
    } catch {
      out.push(p);
    }
  }
  return out;
}

export async function runSelftest(pinia: Pinia, cfg: SelftestConfig) {
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) =>
    checks.push({ name, ok, detail: detail === undefined ? undefined : String(detail) });
  const project = useProjectStore(pinia);
  const preview = usePreviewStore(pinia);
  try {
    const t0 = performance.now();
    check('打开示例项目', await project.openSample(), project.dir);
    if (cfg.mode === 'stress') return await stress(project);
    check('项目目录含 .awb', await platform.exists(await platform.join(project.dir!, '.awb')));
    const loaded = await until(() => preview.spans.length === 3, 20_000);
    check('预览加载 3 个场景', loaded, JSON.stringify(preview.spans));
    check(
      'UX-01 首次看到示例 ≤10s',
      performance.now() - t0 < 10_000,
      `${Math.round(performance.now() - t0)}ms`,
    );
    check('预览无运行时错误', preview.errors.length === 0, JSON.stringify(preview.errors));
    check('预览总时长 17s', Math.abs(preview.duration - 17) < 1e-6, preview.duration);
    preview.seek(12);
    check('seek 生效', await until(() => Math.abs(preview.time - 12) < 0.01, 3000), preview.time);

    check('SEC-04 读 /etc/passwd 被拒', await rejects(platform.readText('/etc/passwd')));
    const home = (await platform.appDataDir()).split('/').slice(0, 3).join('/');
    check('SEC-04 读 ~/.ssh 被拒', await rejects(platform.readDir(`${home}/.ssh`)), home);
    check(
      'SEC-04 写项目目录之外被拒',
      await rejects(platform.writeTextAtomic(`${home}/awb-escape.txt`, 'x')),
    );

    const edited = JSON.parse(JSON.stringify(project.storyboard));
    edited.scenes[2].hold = 5;
    project.update(edited);
    check(
      '编辑后预览更新为 20s',
      await until(() => Math.abs(preview.duration - 20) < 1e-6, 3000),
      preview.duration,
    );
    await project.save(true);
    check(
      '自动保存写盘',
      JSON.parse(await platform.readText(await platform.join(project.dir!, 'storyboard.json'))).scenes[2]
        .hold === 5,
    );
    project.undo();
    await project.save();

    if (cfg.llm) await llmChecks(check, project.dir!);
  } catch (e) {
    check('未捕获异常', false, e instanceof Error ? e.stack : JSON.stringify(e));
  }
  await platform.selftestReport(JSON.stringify(checks));
  return undefined;

  async function llmChecks(check: (n: string, ok: boolean, d?: unknown) => void, dir: string) {
    check(
      'SEC-05 拒绝公网 http Base URL',
      await rejects(platform.secretSet('st', 'http://api.openai.com/v1', MOCK_KEY)),
    );
    const backend = await platform.secretSet('st', cfg.llm!, MOCK_KEY);
    const status = await platform.secretStatus('st');
    check(
      'SEC-03 Key 存入钥匙串，前端只看到末 4 位',
      status.exists && status.last4 === '3456' && !JSON.stringify(status).includes(MOCK_KEY),
      `${backend} ${JSON.stringify(status)}`,
    );
    const deltas: string[] = [];
    const r = await platform.llmChat(
      {
        request_id: newId('req'),
        provider_id: 'st',
        model: 'fast',
        messages: [{ role: 'user', content: 'hi' }],
        json_mode: true,
      },
      (e) => e.type === 'Delta' && deltas.push(e.text),
    );
    check(
      'LLM 代理流式返回',
      deltas.length >= 3 && r.text === deltas.join('') && r.finish_reason === 'stop',
      r.text,
    );
    const id = newId('req');
    const slow = platform.llmChat(
      { request_id: id, provider_id: 'st', model: 'slow', messages: [], json_mode: false },
      () => {},
    );
    setTimeout(() => void platform.llmCancel(id), 500);
    const cancelled = await slow.then(
      () => null,
      (e) => e,
    );
    check('LLM 请求可取消', cancelled?.code === 'cancelled', JSON.stringify(cancelled));
    const err = await platform
      .llmChat(
        { request_id: newId('req'), provider_id: 'st', model: 'err429', messages: [], json_mode: false },
        () => {},
      )
      .catch((e) => e);
    check('429 重试后映射为 rate_limit', err?.code === 'rate_limit', JSON.stringify(err));
    // 写一条 AI 日志后扫描项目目录，确认 Key 没有落盘
    const files = await listFiles(dir);
    let leaked = '';
    for (const f of files) {
      const bytes = await platform.readBinary(f);
      if (new TextDecoder().decode(bytes).includes(MOCK_KEY)) leaked += f + ' ';
    }
    check('SEC-03 项目文件里没有 Key', !leaked, `${files.length} 个文件 ${leaked}`);
    await platform.secretRemove('st');
    check('删除 Key', !(await platform.secretStatus('st')).exists);
  }
}

/** SEC-07：不停修改并保存，外部在随机时刻强杀进程，之后检查 storyboard.json 仍可解析 */
async function stress(project: ReturnType<typeof useProjectStore>) {
  console.log('[selftest] stress 开始');
  for (let i = 0; ; i++) {
    const sb = JSON.parse(JSON.stringify(project.storyboard));
    sb.meta.title = `压力测试 ${i} ${'x'.repeat(i % 2000)}`;
    project.update(sb);
    await project.save(i % 10 === 0);
  }
}
