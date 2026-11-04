import { platform } from '../../platform';
import { useProjectStore } from '../../stores/project';
import { useSettingsStore } from '../../stores/settings';
import { aiSession } from '../session';
import { acceptStoryboard, applyAgentScenes } from './apply';
import { agentToolsEnabled, diskFrameStore, runVisionReview, visionContext } from './frames';
import type { AgentLogEvent } from './log';
import { DEFAULT_AGENT_BUDGET_SETTINGS, budgetFromSettings } from './log';
import type { AgentBudget, AgentHost, AgentResult, RunAgentOpts } from './loop';
import { runAgent } from './loop';
import { isAnimPath } from './parse';
import { readRendererFile, resolveAgentRenderer, writeRendererFile, type CodeRenderer } from './renderer';

/** 把 agent 的旁路文件放进 <project>/.awb/anim/，不改 PROJECT_DIRS，也不另立一套撤销。 */
export function projectAgentHost(): AgentHost {
  const project = useProjectStore();
  return {
    getStoryboard: () => project.storyboard,
    updateStoryboard: (next) => project.update(next),
    async writeFile(name, text) {
      if (!isAnimPath(name)) throw new Error(`拒绝写入：${name}`);
      if (!project.dir) throw new Error('没有打开的项目');
      const base = await platform.join(project.dir, '.awb', 'anim');
      await platform.mkdir(base);
      const parts = name.split('/');
      const sub = parts.length === 2 ? parts[0] : undefined;
      if (sub) await platform.mkdir(await platform.join(base, sub));
      await platform.writeTextAtomic(await platform.join(base, ...parts), text);
    },
    async readFile(name) {
      if (!isAnimPath(name) || !project.dir) return null;
      const file = await platform.join(project.dir, '.awb', 'anim', ...name.split('/'));
      if (!(await platform.exists(file))) return null;
      return platform.readText(file);
    },
  };
}

function reviewContract(renderer: CodeRenderer): string {
  return renderer === 'manim'
    ? '这一场是 manim-web。函数体签名是 (scene, M, ctx)。'
    : '这一场是 HTML/SVG + GSAP。函数体签名是 (root, gsap, tl, ctx)，动画都在 tl 上。';
}

function isCancelled(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code?: unknown }).code === 'cancelled';
}

/** 用当前会话的模型通道跑 agent。json_mode 不传，避免强制 json_object。 */
export async function runProjectAgent(
  intent: string,
  opts: {
    signal?: AbortSignal;
    budget?: Partial<AgentBudget>;
    onPhase?: RunAgentOpts['onPhase'];
    onLog?: (event: AgentLogEvent) => void;
  } = {},
): Promise<AgentResult> {
  const session = aiSession();
  const settings = useSettingsStore();
  const project = useProjectStore();
  const budget = opts.budget ?? budgetFromSettings(settings.agentBudget);
  const completionTokens =
    budget.completionTokens === undefined
      ? DEFAULT_AGENT_BUDGET_SETTINGS.completionTokens
      : budget.completionTokens;
  const transport: RunAgentOpts['transport'] = (messages, call) =>
    session.transport(messages, {
      ...call,
      jsonMode: null,
      ...(typeof completionTokens === 'number' ? { maxTokens: completionTokens } : {}),
    });
  const sidecar = project.dir ? await readRendererFile(project.dir) : null;
  const hasCodeScenes = (project.storyboard?.scenes ?? []).some(
    (scene) => scene.kind === 'code' && !!scene.code?.trim(),
  );
  const renderer = resolveAgentRenderer({
    sidecar,
    fallback: settings.runtime.codeRenderer === 'manim' ? 'manim' : 'gsap',
    hasCodeScenes,
  });
  if (project.dir && sidecar !== renderer) await writeRendererFile(project.dir, renderer);
  const result = await runAgent({
    intent,
    host: projectAgentHost(),
    budget,
    renderer,
    signal: opts.signal,
    onPhase: opts.onPhase,
    onLog: opts.onLog,
    onCancelRequest: (id) => session.cancel(id),
    transport,
  });
  // 闭环工具默认关。关掉时不截帧，runAgent 仍是一次性写 code。
  if (opts.signal?.aborted || result.status !== 'done' || !agentToolsEnabled(settings.runtime.agentTools)) {
    return result;
  }
  const spent = result.usage[0] + result.usage[1];
  if (budget.maxTokens !== undefined && spent >= budget.maxTokens) {
    opts.onLog?.({ type: 'note', message: '预算已用完，不再做截帧检查' });
    return result;
  }
  opts.onLog?.({ type: 'phase', phase: 'review', turn: result.turns + 1 });
  try {
    const review = await runVisionReview({
      enabled: true,
      messages: [
        {
          role: 'user',
          content: `用户需求（这是指令，不是素材）：\n${intent}\n\n代码场景已经写好。${reviewContract(renderer)}请调用 render_frames，再用 check_layout 和 check_residual 看画面。有真实问题就用 write_scene 改那一场，然后重新截帧。`,
        },
      ],
      transport,
      revise: reviseScene,
      ctx: visionContext({
        getStoryboard: () => project.storyboard,
        store: project.dir ? diskFrameStore(project.dir) : undefined,
      }),
      signal: opts.signal,
      onCancelRequest: (id) => session.cancel(id),
      onTool: (call) =>
        opts.onLog?.({
          type: 'tool',
          name: call.name,
          arguments: call.arguments,
          result: call.result,
        }),
    });
    if (review.status === 'cancelled' || opts.signal?.aborted) {
      opts.onLog?.({ type: 'status', status: 'cancelled', message: '已取消' });
      return { ...result, status: 'cancelled' };
    }
    if (review.status === 'max_rounds') {
      opts.onLog?.({ type: 'note', message: '截帧检查达到本轮预算，已停下' });
    } else if (review.status === 'done' && review.text.trim()) {
      opts.onLog?.({ type: 'note', message: review.text.trim().slice(0, 500) });
    }
  } catch (e) {
    if (opts.signal?.aborted || isCancelled(e)) {
      opts.onLog?.({ type: 'status', status: 'cancelled', message: '已取消' });
      return { ...result, status: 'cancelled' };
    }
    const message = e instanceof Error ? e.message : String(e);
    opts.onLog?.({ type: 'note', message: `截帧检查失败：${message}` });
  }
  return result;
}

const SCENE_ID = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

/** 检查之后改一场。走现有的 apply + project.update，不另开写入口。 */
async function reviseScene(sceneId: string, code: string): Promise<string> {
  if (!SCENE_ID.test(sceneId)) return `场次 id 不合法：${sceneId}`;
  const host = projectAgentHost();
  const storyboard = host.getStoryboard();
  if (!storyboard) return '没有打开的分镜';
  const existing = storyboard.scenes.find((scene) => scene.id === sceneId);
  if (!existing) return `没有场 ${sceneId}`;
  if (existing.locked) return `场 ${sceneId} 已锁定，没有改`;
  const body = code.trim();
  if (!body) return '代码是空的，没有写入';
  const shared = (await host.readFile('shared.js')) ?? '';
  await host.writeFile(`scenes/${sceneId}.js`, body);
  const applied = applyAgentScenes({
    storyboard,
    planned: [
      {
        id: existing.id,
        title: existing.title,
        description: existing.description,
        hold: existing.hold,
        enter: existing.enter === 'keep' ? 'keep' : 'fresh',
      },
    ],
    codes: new Map([[sceneId, body]]),
    shared,
    adoptTitle: null,
  });
  if (!applied.changed) return `场 ${sceneId} 没有变化`;
  const accepted = acceptStoryboard(applied.storyboard);
  if (!accepted) return '写回的分镜无法通过 schema';
  host.updateStoryboard(accepted);
  return `已重写场 ${sceneId}`;
}
