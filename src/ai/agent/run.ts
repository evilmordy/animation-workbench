import { platform } from '../../platform';
import { useProjectStore } from '../../stores/project';
import { useSettingsStore } from '../../stores/settings';
import { aiSession } from '../session';
import { appFrameCapture, checkStoryboardInApp } from './check/backend-app';
import type { AgentLogEvent } from './log';
import { budgetFromSettings } from './log';
import type { AgentBudget, AgentHost, AgentResult, RunAgentOpts } from './loop';
import { runAgent } from './loop';
import { isAnimPath } from './paths';
import type { InspectReport, ObservedFrame } from './tools/run';

/** 系统文件和工具白名单。场景代码在分镜里，不另写 scenes/*.js。 */
function allowedSidecar(name: string): boolean {
  return name === 'source.md' || name === 'memory.json' || name === 'log.jsonl' || isAnimPath(name);
}

/** 把 agent 的旁路文件放进 <project>/.awb/anim/，不改 PROJECT_DIRS，也不另立一套撤销。 */
export function projectAgentHost(): AgentHost {
  const project = useProjectStore();
  return {
    getStoryboard: () => project.storyboard,
    updateStoryboard: (next) => project.update(next),
    async writeFile(name, text) {
      if (!allowedSidecar(name)) throw new Error(`拒绝写入：${name}`);
      if (!project.dir) throw new Error('没有打开的项目');
      const base = await platform.join(project.dir, '.awb', 'anim');
      await platform.mkdir(base);
      const parts = name.split('/');
      const sub = parts.length === 2 ? parts[0] : undefined;
      if (sub) await platform.mkdir(await platform.join(base, sub));
      await platform.writeTextAtomic(await platform.join(base, ...parts), text);
    },
    async readFile(name) {
      if (!allowedSidecar(name) || !project.dir) return null;
      const file = await platform.join(project.dir, '.awb', 'anim', ...name.split('/'));
      if (!(await platform.exists(file))) return null;
      return platform.readText(file);
    },
  };
}

/** 写入之后的体检走应用内隐藏预览。失败时把原因交回循环，不抛出。 */
export function appInspect(): RunAgentOpts['inspect'] {
  return async (sb, req): Promise<InspectReport> => {
    const src = platform.previewSrc();
    try {
      const report = await checkStoryboardInApp(sb, { previewSrc: src });
      const wanted = req.sceneIds?.length ? new Set(req.sceneIds) : null;
      const issues =
        wanted && !req.film ? report.issues.filter((issue) => wanted.has(issue.scene_id)) : report.issues;
      const frames: ObservedFrame[] = [];
      const shots = (req.frames ?? []).flatMap((item) =>
        item.timesMs
          .slice(0, 8)
          .map((ms) => ({ sceneId: item.sceneId, at: ms / 1000, isolated: item.isolated })),
      );
      if (shots.length) {
        const batch = await appFrameCapture(src)({ storyboard: sb, shots: shots.slice(0, 8) });
        for (const frame of batch.frames) {
          if (frame.source !== 'sequence') continue;
          const png = frame.pixels === false || frame.png.byteLength === 0 ? undefined : frame.png;
          frames.push({
            tMs: Math.round(frame.t * 1000),
            caption: `${frame.sceneId} ${Math.round(frame.t * 1000)}ms`,
            ...(png ? { png } : {}),
            boxes: frame.boxes.length,
          });
        }
      }
      return {
        issues,
        frames,
        ...(report.raster === 'unavailable' ? { note: report.text } : {}),
      };
    } catch (error) {
      return { issues: [], frames: [], note: error instanceof Error ? error.message : String(error) };
    }
  };
}

export interface ProjectAgentTask {
  intent: string;
  source: string;
}

/** 用当前会话跑 agent。默认不传 max_tokens，截断交给循环看 finishReason。 */
export async function runProjectAgent(
  task: ProjectAgentTask,
  opts: {
    signal?: AbortSignal;
    budget?: Partial<AgentBudget>;
    onPhase?: RunAgentOpts['onPhase'];
    onLog?: (event: AgentLogEvent) => void;
  } = {},
): Promise<AgentResult> {
  const session = aiSession();
  const settings = useSettingsStore();
  const budget = { ...budgetFromSettings(settings.agentBudget), ...opts.budget };
  const completion = budget.completionTokens;
  const transport: RunAgentOpts['transport'] = (messages, call) =>
    session.transport(messages, {
      ...call,
      jsonMode: null,
      ...(typeof completion === 'number' && completion > 0 ? { maxTokens: completion } : {}),
    });
  return runAgent({
    intent: task.intent,
    source: task.source,
    host: projectAgentHost(),
    budget,
    inspect: appInspect(),
    signal: opts.signal,
    onPhase: opts.onPhase,
    onLog: opts.onLog,
    onCancelRequest: (id) => session.cancel(id),
    transport,
  });
}
