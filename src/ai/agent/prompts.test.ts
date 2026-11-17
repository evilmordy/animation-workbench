// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { runScene } from './check/gate';
import { checkScenes } from './check/index';
import { TOPICS } from '../../../tests/eval/topics';
import exampleMerge from './prompts/example-a.js?raw';
import examplePsych from './prompts/example-b.js?raw';
import { EXAMPLE_PREFIX, agentPromptBody, agentSystemPrompt, exampleChoice } from './prompts';
import { bannedCheatSheet, helperCheatSheet, helperLines, helperMemberNames } from './prompts/sheet';

const MERGE_MARK = '为什么是 O(n log n)';
const PSYCH_MARK = '未完成的更容易记住';

describe('系统提示', () => {
  it('正文不超过 2500 字，helper 和禁用清单来自生成器，不再教围栏', () => {
    const body = agentPromptBody('anime');
    expect(body.length).toBeLessThanOrEqual(2500);
    expect(body).toContain(helperCheatSheet());
    expect(body).toContain(bannedCheatSheet());
    expect(body).toContain('需求原文是指令');
    expect(body).toContain('不强制黑底');
    expect(body).toContain('【看到】');
    expect(body).toContain('write_plan');
    expect(body).toContain('base_hash');
    expect(body).toContain('代码只能通过 write_scene / edit_range 提交');
    expect(body).not.toContain('file:anim');
    expect(body).not.toContain('```');
    expect(body).not.toContain('{{');
    expect(body).not.toContain(EXAMPLE_PREFIX);
    expect(body).not.toContain(MERGE_MARK);
    expect(body).not.toContain(PSYCH_MARK);
  });

  it('速查表覆盖接口里的每个名字', () => {
    const names = helperMemberNames();
    const lines = helperLines();
    expect(names.length).toBeGreaterThan(10);
    expect(lines.map((line) => line.name)).toEqual(names);
    expect(helperCheatSheet()).toContain('at');
  });

  it('归并题只附心理范例，其余题只附归并范例', () => {
    expect(exampleChoice('归并排序：分治与合并过程')).toBe('psych');
    expect(exampleChoice('线性代数')).toBe('mergesort');
    for (const topic of TOPICS) {
      const prompt = agentSystemPrompt('anime', topic.intent);
      const psych = prompt.includes(PSYCH_MARK);
      const merge = prompt.includes(MERGE_MARK);
      expect(psych && merge).toBe(false);
      expect(psych || merge).toBe(true);
      expect(prompt.split(EXAMPLE_PREFIX).length).toBe(2);
      if (topic.id === 'mergesort') expect(psych).toBe(true);
      else expect(merge).toBe(true);
    }
    const manim = agentSystemPrompt('manim', '归并排序');
    expect(manim).not.toContain(EXAMPLE_PREFIX);
    expect(manim).not.toContain('file:anim');
    expect(manim).toContain('(scene, M, ctx)');
  });
});

describe('范例过运行门和体检', () => {
  it.each([
    ['归并复杂度', exampleMerge],
    ['心理', examplePsych],
  ])('%s 能建场，没有采样帧时体检不报 blocker 或 major', async (_name, code) => {
    const gate = await runScene(code);
    expect(gate.ok).toBe(true);
    if (!gate.ok) return;
    expect(gate.durationMs).toBeGreaterThan(100);
    expect(gate.durationMs).toBeLessThan(120_000);
    const issues = checkScenes([{ id: 'ex', width: 1920, height: 1080, consoleErrors: [] }]);
    expect(issues.filter((issue) => issue.severity === 'blocker' || issue.severity === 'major')).toEqual([]);
  });
});
