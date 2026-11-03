import { platform } from '../../platform';
import { useProjectStore } from '../../stores/project';
import { aiSession } from '../session';
import type { AgentBudget, AgentHost, AgentResult, RunAgentOpts } from './loop';
import { runAgent } from './loop';
import { isAnimPath } from './parse';

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

/** 用当前会话的模型通道跑 agent。json_mode 不传，避免强制 json_object。 */
export async function runProjectAgent(
  intent: string,
  opts: {
    signal?: AbortSignal;
    budget?: Partial<AgentBudget>;
    onPhase?: RunAgentOpts['onPhase'];
  } = {},
): Promise<AgentResult> {
  const session = aiSession();
  return runAgent({
    intent,
    host: projectAgentHost(),
    budget: opts.budget,
    signal: opts.signal,
    onPhase: opts.onPhase,
    onCancelRequest: (id) => session.cancel(id),
    transport: (messages, call) => session.transport(messages, { ...call, jsonMode: null }),
  });
}
