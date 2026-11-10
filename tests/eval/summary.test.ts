// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { Transport } from '../../src/ai/client';
import { encodePng } from '../../src/ai/agent/check/pixels';
import type { Issue } from '../../src/ai/agent/check/index';
import { assembleExportHtml } from '../../src/features/export/exportHtml';
import { parseStoryboard } from '../../src/shared/schema';
import { decodePng } from './png';
import {
  deepseekRequestBody,
  evaluateTopic,
  exportPasses,
  flagsFromScreen,
  mathNote,
  officialPass,
} from './summary';
import { TOPICS } from './topics';

const SCENE = [
  "const box = el('div', { left: 80, top: 80, width: 200, height: 80, background: C.blue }, '未完成的任务');",
  'fadeIn(box, 0);',
  'wait(1000);',
].join('\n');

function scripted(): Transport {
  const plan = [
    '```file:anim/plan.md',
    '# 现象',
    '```',
    '```file:anim/rubric.json',
    '{"title":"蔡格尼克效应","scenes":[{"id":"s_effect","title":"现象","description":"未完成的任务更容易被记住","hold":1,"enter":"fresh"}]}',
    '```',
  ].join('\n');
  const scene = ['```file:anim/scenes/s_effect.js', SCENE, '```'].join('\n');
  let n = 0;
  return async () => {
    n += 1;
    return { text: n === 1 ? plan : scene, usage: [10, 20] as [number, number] };
  };
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  return out;
}

describe('五题评测', () => {
  it('题面与设计书 §11.1 逐字相同', () => {
    expect(TOPICS.map((topic) => topic.id)).toEqual(['zugeng', 'linalg', 'mergesort', 'transform', 'psych']);
    expect(TOPICS.map((topic) => topic.intent)).toEqual([
      '祖暅原理：用祖暅原理推导球体积（半球与圆柱挖去圆锥，任意高度截面积相等）',
      '线性代数：矩阵作为线性变换（基向量变换、行列式是面积缩放）',
      '归并排序：分治与合并过程，含复杂度 O(n log n)',
      'Transform 的数学原理与实现动画：一个图形如何通过逐点线性插值 P(t)=(1-t)·A+t·B 变成另一个图形（点对齐/重采样、插值、缓动函数 rate(t)），并展示关键参数 t 处的中间帧与公式一致',
      '心理学小知识：蔡格尼克效应——讲清现象（未完成的任务比已完成的更容易被记住）、经典实验与解释',
    ]);
  });

  it('官方 PASS 要求九项全过，抽查不改结论', () => {
    const clean = {
      gate: true,
      layout: true,
      residual: true,
      seek: true,
      backward: true,
      shuffle: true,
      export: true,
      console: true,
      blackRatio: 0.1,
    };
    expect(officialPass(clean)).toBe(true);
    expect(officialPass({ ...clean, blackRatio: 0.11 })).toBe(false);
    expect(officialPass({ ...clean, seek: false })).toBe(false);
    expect(officialPass({ ...clean, blackRatio: null })).toBe(false);
    expect(mathNote('zugeng', '半球 (2/3)πR³，整球 (4/3)πR³')).toContain('见 (2/3)πR³');
    expect(mathNote('zugeng', '没有公式')).toContain('缺 (4/3)πR³');
    expect(mathNote('mergesort', '总工作量 O(n log n)')).toContain('见 O(n log n)');
    expect(mathNote('linalg', '只写了线性')).toContain('缺矩阵');
  });

  it('后向和乱序分开计，单帧空画面不单独否决', () => {
    const issue = (kind: Issue['kind'], label: string): Issue => ({
      id: 'x',
      scene_id: 's',
      kind,
      severity: 'blocker',
      evidence: {},
      fingerprint: `${kind}|s|${label}|0`,
      first_turn: 0,
      last_turn: 0,
      attempts: 1,
      status: 'open',
    });
    const backward = flagsFromScreen({
      issues: [issue('SEEK_BACKWARD', 'backward')],
      blackRatio: 0,
      exportOk: true,
      layoutTruncated: false,
    });
    expect(backward.backward).toBe(false);
    expect(backward.shuffle).toBe(true);
    const blank = flagsFromScreen({
      issues: [issue('BLANK', 'empty')],
      blackRatio: 0.05,
      exportOk: true,
      layoutTruncated: false,
    });
    expect(officialPass({ gate: true, ...blank })).toBe(true);
  });

  it('冒烟一题：脚本模型写出能过运行门的场，没截帧就不算 PASS', async () => {
    const row = await evaluateTopic({ topic: TOPICS[4], transport: scripted(), maxTurns: 4 });
    expect(row.id).toBe('psych');
    expect(row.status).toBe('done');
    expect(row.scenes).toBe(1);
    expect(row.turns).toBe(2);
    expect(row.tokens).toBe(60);
    expect(row.writes).toBe(1);
    expect(row.stuck).toEqual([]);
    expect(row.gate).toBe(true);
    expect(row.gateErrors).toEqual([]);
    expect(row.screen).toBe('skipped');
    expect(row.layout).toBe(false);
    expect(row.residual).toBe(false);
    expect(row.seek).toBe(false);
    expect(row.blackRatio).toBeNull();
    expect(row.pass).toBe(false);
    expect(row.math).toContain('见');
    expect(row.math).toContain('不计入 PASS');
    expect(row.waived).toEqual([]);
  });

  it('画面列全过时，缺公式仍然 PASS', async () => {
    const row = await evaluateTopic({
      topic: TOPICS[0],
      transport: scripted(),
      maxTurns: 4,
      screen: async () => ({ issues: [], blackRatio: 0, exportOk: true, layoutTruncated: false }),
    });
    expect(row.gate).toBe(true);
    expect(row.screen).toBe('ran');
    expect(row.pass).toBe(true);
    expect(row.math).toContain('缺 (2/3)πR³');
  });

  it('请求体固定 deepseek-chat、0.3、65536，且没有密钥和 json_object', () => {
    const body = deepseekRequestBody([{ role: 'user', content: '画一个圆' }]);
    expect(body).toEqual({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: '画一个圆' }],
      temperature: 0.3,
      max_tokens: 65536,
    });
    expect(JSON.stringify(body)).not.toContain('response_format');
    const source = readFileSync(join(process.cwd(), 'tests/eval/run.eval.ts'), 'utf8');
    expect(source).toContain('DEEPSEEK_API_KEY');
    expect(source).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
    expect(source).not.toContain('response_format');
  });

  it('PNG 往返，Sub 过滤和 RGB 也能解', () => {
    const raster = {
      width: 2,
      height: 2,
      rgba: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
    };
    expect(decodePng(encodePng(raster))).toEqual(raster);

    const raw = Uint8Array.from([0, 9, 10, 11, 12, 5, 6, 7, 8, 1, 10, 11, 12, 13, 4, 5, 6, 7]);
    const ihdr = new Uint8Array(13);
    const view = new DataView(ihdr.buffer);
    view.setUint32(0, 2);
    view.setUint32(4, 2);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const png = Uint8Array.from([
      137,
      80,
      78,
      71,
      13,
      10,
      26,
      10,
      ...pngChunk('IHDR', ihdr),
      ...pngChunk('IDAT', deflateSync(raw)),
      ...pngChunk('IEND', new Uint8Array()),
    ]);
    const decoded = decodePng(png);
    expect([...decoded.rgba.slice(0, 8)]).toEqual([9, 10, 11, 12, 5, 6, 7, 8]);
    expect([...decoded.rgba.slice(8)]).toEqual([10, 11, 12, 13, 14, 16, 18, 20]);

    const rgb = Uint8Array.from([0, 1, 2, 3]);
    const rgbHeader = new Uint8Array(13);
    new DataView(rgbHeader.buffer).setUint32(0, 1);
    new DataView(rgbHeader.buffer).setUint32(4, 1);
    rgbHeader[8] = 8;
    rgbHeader[9] = 2;
    const rgbPng = Uint8Array.from([
      137,
      80,
      78,
      71,
      13,
      10,
      26,
      10,
      ...pngChunk('IHDR', rgbHeader),
      ...pngChunk('IDAT', deflateSync(rgb)),
      ...pngChunk('IEND', new Uint8Array()),
    ]);
    expect([...decodePng(rgbPng).rgba]).toEqual([1, 2, 3, 255]);
  });

  it('导出检查认内联运行时，拒绝外链脚本', async () => {
    const parsed = parseStoryboard({
      schemaVersion: 1,
      meta: { title: '导出', mode: '2d', aspect: '16:9', background: '#000000', stylePreset: '3b1b' },
      scenes: [
        {
          id: 's_effect',
          title: '现象',
          description: '一场',
          kind: 'code',
          enter: 'fresh',
          hold: 1,
          elements: [],
          steps: [],
          code: 'wait(1000);',
        },
      ],
    });
    if (!parsed.ok) throw new Error('bad board');
    const html = await assembleExportHtml('runtime-body-marker', parsed.value, {
      slides: false,
      loop: false,
      codeScenes: true,
    });
    expect(exportPasses(html, 'runtime-body-marker')).toBe(true);
    expect(
      exportPasses(
        html.replace('runtime-body-marker', '<script src="https://cdn.example/a.js"></script>'),
        'nope',
      ),
    ).toBe(false);
  });
});
