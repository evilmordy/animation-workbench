import type { Pinia } from 'pinia';
import { platform } from './platform';
import { useProjectStore } from './stores/project';
import { usePreviewStore } from './stores/preview';

/** 真实 Tauri 环境自检（AWB_SELFTEST=1 启动 debug 构建时运行），结果打印到终端 */

type Check = { name: string; ok: boolean; detail?: string };

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

export async function runSelftest(pinia: Pinia) {
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) =>
    checks.push({ name, ok, detail: detail === undefined ? undefined : String(detail) });
  const project = useProjectStore(pinia);
  const preview = usePreviewStore(pinia);
  try {
    const t0 = performance.now();
    check('打开示例项目', await project.openSample(), project.dir);
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

    const fixture = JSON.parse(JSON.stringify(project.storyboard));
    fixture.scenes[2].hold = 5;
    project.update(fixture);
    check(
      '编辑后预览更新为 20s',
      await until(() => Math.abs(preview.duration - 20) < 1e-6, 3000),
      preview.duration,
    );
    await project.save();
    check(
      '自动保存写盘',
      JSON.parse(await platform.readText(await platform.join(project.dir!, 'storyboard.json'))).scenes[2]
        .hold === 5,
    );
    project.undo();
    await project.save();
  } catch (e) {
    check('未捕获异常', false, e instanceof Error ? e.stack : JSON.stringify(e));
  }
  await platform.selftestReport(JSON.stringify(checks));
}
