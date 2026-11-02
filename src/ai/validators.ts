import type { z } from 'zod';
import { applyOps, EditOps, type ApplyResult } from '../shared/ops';
import { formatPath, Scene, type Storyboard } from '../shared/schema';
import { validate } from '../shared/validate';
import { Outline, type EditScope } from './prompts';

/** 校验结果：issues 为空表示通过；issues 会原样回传给模型做修复 */
export interface Checked<T> {
  value?: T;
  issues: string[];
}

const zodIssues = (e: z.ZodError) => e.issues.map((i) => `${formatPath(i.path) || '(根)'}：${i.message}`);

export function checkOutline(data: unknown): Checked<Outline> {
  const r = Outline.safeParse(data);
  return r.success ? { value: r.data, issues: [] } : { issues: zodIssues(r.error) };
}

/** 单场景：结构 + 放进一个只有它的分镜里做语义校验（初次生成的场景都应自给自足） */
export function checkScene(data: unknown, sceneId: string, meta: Storyboard['meta']): Checked<Scene> {
  if (data && typeof data === 'object') (data as { id?: string }).id = sceneId;
  const r = Scene.safeParse(data);
  if (!r.success) return { issues: zodIssues(r.error) };
  if (r.data.kind !== 'dsl') return { issues: ['kind：必须是 "dsl"'] };
  const scene = { ...r.data, enter: 'fresh' as const };
  const errors = validate({ schemaVersion: 1, meta, scenes: [scene] }).filter((i) => i.level === 'error');
  return errors.length
    ? { issues: errors.map((i) => `${i.path.replace(/^scenes\[0\]\.?/, '') || '(场景)'}：${i.message}`) }
    : { value: scene, issues: [] };
}

/** 修改操作：结构 + 应用后整片校验，只追究被改动场景里的错误 */
export function checkEdit(data: unknown, sb: Storyboard, scope: EditScope): Checked<ApplyResult> {
  const r = EditOps.safeParse(data);
  if (!r.success) return { issues: zodIssues(r.error) };
  const ops =
    scope.kind === 'scene'
      ? r.data.ops.filter((op) => (op.op === 'insertScene' ? true : op.id === scope.sceneId))
      : r.data.ops;
  const applied = applyOps(sb, ops);
  const outOfScope = r.data.ops.length - ops.length;
  if (outOfScope) applied.skipped.push(`${outOfScope} 个操作超出修改范围，已忽略`);
  const changed = new Set(applied.changed);
  const issues = validate(applied.storyboard)
    .filter((i) => i.level === 'error')
    .filter((i) => {
      const m = /^scenes\[(\d+)\]/.exec(i.path);
      return !m || changed.has(applied.storyboard.scenes[Number(m[1])]?.id ?? '');
    })
    .map((i) => {
      const m = /^scenes\[(\d+)\]/.exec(i.path);
      const id = m ? applied.storyboard.scenes[Number(m[1])]?.id : null;
      return `${id ? `场景 ${id} ` : ''}${i.path.replace(/^scenes\[\d+\]\.?/, '')}：${i.message}`;
    });
  return issues.length ? { issues } : { value: applied, issues: [] };
}
