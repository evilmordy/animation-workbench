import {
  checkLayout,
  compareResidual,
  contentRatio,
  diffPixels,
  type LayoutBox,
  type Raster,
} from './pixels';

/**
 * 体检。设计书 §7.2 的六项，返回 §5.3 的 Issue。
 * 编译、运行、时长由运行门单独判定，不在这里。
 */

export type IssueKind =
  | 'COMPILE'
  | 'RUNTIME'
  | 'DURATION'
  | 'BLANK'
  | 'LAYOUT_OVERLAP'
  | 'LAYOUT_OVERFLOW_TEXT'
  | 'LAYOUT_OVERFLOW_OTHER'
  | 'RESIDUAL'
  | 'SEEK_BACKWARD'
  | 'SEEK_SAME_MS'
  | 'CONSOLE'
  | 'CONTENT'
  | 'USER';

export type IssueSeverity = 'blocker' | 'major' | 'minor';
export type IssueStatus = 'open' | 'fixed' | 'waived' | 'stuck';

export interface IssueEvidence {
  t_ms?: number;
  text?: string;
  bbox?: [number, number, number, number];
  ratio?: number;
  frame?: string;
}

export interface Issue {
  id: string;
  scene_id: string;
  kind: IssueKind;
  severity: IssueSeverity;
  evidence: IssueEvidence;
  fingerprint: string;
  first_turn: number;
  last_turn: number;
  attempts: number;
  status: IssueStatus;
}

export interface CheckFrame {
  tMs: number;
  raster?: Raster;
  boxes?: LayoutBox[];
  truncated?: boolean;
}

export interface SameMsProbe {
  tMs: number;
  first: Raster;
  second: Raster;
}

export interface SeekProbe {
  tMs: number;
  forward: Raster;
  backward: Raster;
  shuffled: Raster;
}

export interface ResidualProbe {
  tMs: number;
  sequence: Raster;
  isolated: Raster;
}

export interface SceneCheckInput {
  id: string;
  width: number;
  height: number;
  frames?: CheckFrame[];
  sameMs?: SameMsProbe[];
  seek?: SeekProbe[];
  residual?: ResidualProbe;
  consoleErrors?: string[];
}

/** 非背景像素少于此值，记「画面几乎是空的」。 */
const EMPTY_CONTENT = 0.003;
/** 几乎是空的帧占比超过此值，才是黑屏 blocker。一帧过渡不够。 */
const BLACK_FRAME_RATIO = 0.1;
const SAME_MS_DELTA = 2;
const SEEK_DELTA = 24;
const SEEK_RATIO = 0.001;

const ID_PREFIX: Partial<Record<IssueKind, string>> = {
  BLANK: 'B',
  LAYOUT_OVERLAP: 'L',
  LAYOUT_OVERFLOW_TEXT: 'L',
  LAYOUT_OVERFLOW_OTHER: 'L',
  RESIDUAL: 'R',
  SEEK_BACKWARD: 'S',
  SEEK_SAME_MS: 'S',
  CONSOLE: 'C',
};

interface Draft {
  sceneId: string;
  kind: IssueKind;
  severity: IssueSeverity;
  evidence: IssueEvidence;
  label: string;
  tMs?: number;
}

/** 每场 7 个采样点，从时长的 5% 到 95%。 */
export function seekTimes(durationMs: number): number[] {
  const duration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const times: number[] = [];
  for (let i = 0; i < 7; i++) times.push(Math.round(duration * (0.05 + (0.9 * i) / 6)));
  return times;
}

function bucket(tMs: number | undefined): string {
  if (tMs == null || !Number.isFinite(tMs)) return '';
  return String(Math.floor(tMs / 500) * 500);
}

function fingerprint(kind: IssueKind, sceneId: string, label: string, tMs: number | undefined): string {
  return [kind, sceneId, label, bucket(tMs)].join('|');
}

function push(drafts: Draft[], seen: Set<string>, draft: Draft) {
  const key = fingerprint(draft.kind, draft.sceneId, draft.label, draft.tMs);
  if (seen.has(key)) return;
  seen.add(key);
  drafts.push(draft);
}

function layoutIssues(scene: SceneCheckInput, frame: CheckFrame, drafts: Draft[], seen: Set<string>) {
  if (!frame.boxes) return;
  const report = checkLayout({
    width: scene.width,
    height: scene.height,
    boxes: frame.boxes,
    ...(frame.truncated ? { truncated: true } : {}),
  });
  for (const hit of report.hits) {
    if (hit.kind === 'overflow') {
      const text = hit.role === 'text';
      push(drafts, seen, {
        sceneId: scene.id,
        kind: text ? 'LAYOUT_OVERFLOW_TEXT' : 'LAYOUT_OVERFLOW_OTHER',
        severity: text ? 'major' : 'minor',
        label: hit.text || hit.id,
        tMs: frame.tMs,
        evidence: {
          t_ms: frame.tMs,
          ...(hit.text ? { text: hit.text } : {}),
          ...(hit.bbox ? { bbox: hit.bbox } : {}),
        },
      });
      continue;
    }
    push(drafts, seen, {
      sceneId: scene.id,
      kind: 'LAYOUT_OVERLAP',
      severity: 'major',
      label: hit.text || `${hit.id}+${hit.otherId ?? ''}`,
      tMs: frame.tMs,
      evidence: {
        t_ms: frame.tMs,
        ...(hit.text ? { text: hit.text } : {}),
        ...(hit.ratio != null ? { ratio: hit.ratio } : {}),
        ...(hit.bbox ? { bbox: hit.bbox } : {}),
      },
    });
  }
}

function blankIssues(scene: SceneCheckInput, drafts: Draft[], seen: Set<string>) {
  const frames = (scene.frames ?? []).filter((frame): frame is CheckFrame & { raster: Raster } =>
    Boolean(frame.raster),
  );
  let empty = 0;
  for (const frame of frames) {
    const ratio = contentRatio(frame.raster);
    if (ratio >= EMPTY_CONTENT) continue;
    empty += 1;
    push(drafts, seen, {
      sceneId: scene.id,
      kind: 'BLANK',
      severity: 'major',
      label: 'empty',
      tMs: frame.tMs,
      evidence: { t_ms: frame.tMs, ratio, text: '画面几乎是空的' },
    });
  }
  const ratio = frames.length ? empty / frames.length : 0;
  if (ratio > BLACK_FRAME_RATIO) {
    push(drafts, seen, {
      sceneId: scene.id,
      kind: 'BLANK',
      severity: 'blocker',
      label: 'black',
      evidence: { ratio, text: `黑屏比 ${ratio.toFixed(2)}，超过 0.1` },
    });
  }
}

function seekMismatch(
  sceneId: string,
  tMs: number,
  left: Raster,
  right: Raster,
  label: string,
  drafts: Draft[],
  seen: Set<string>,
) {
  const diff = diffPixels(left, right, SEEK_DELTA);
  if (!diff || diff.ratio <= SEEK_RATIO) return;
  push(drafts, seen, {
    sceneId,
    kind: 'SEEK_BACKWARD',
    severity: 'blocker',
    label,
    tMs,
    evidence: { t_ms: tMs, ratio: diff.ratio },
  });
}

function inspect(scene: SceneCheckInput, drafts: Draft[], seen: Set<string>) {
  for (const frame of scene.frames ?? []) layoutIssues(scene, frame, drafts, seen);
  blankIssues(scene, drafts, seen);
  for (const probe of scene.sameMs ?? []) {
    const diff = diffPixels(probe.first, probe.second, SAME_MS_DELTA);
    if (!diff || diff.count === 0) continue;
    push(drafts, seen, {
      sceneId: scene.id,
      kind: 'SEEK_SAME_MS',
      severity: 'blocker',
      label: 'same',
      tMs: probe.tMs,
      evidence: { t_ms: probe.tMs, ratio: diff.ratio },
    });
  }
  for (const probe of scene.seek ?? []) {
    seekMismatch(scene.id, probe.tMs, probe.forward, probe.backward, 'backward', drafts, seen);
    seekMismatch(scene.id, probe.tMs, probe.forward, probe.shuffled, 'shuffled', drafts, seen);
  }
  if (scene.residual) {
    const report = compareResidual(scene.residual.sequence, scene.residual.isolated);
    if (report.suspect) {
      push(drafts, seen, {
        sceneId: scene.id,
        kind: 'RESIDUAL',
        severity: 'blocker',
        label: 'residual',
        tMs: scene.residual.tMs,
        evidence: { t_ms: scene.residual.tMs, ratio: report.leftoverRatio },
      });
    }
  }
  for (const message of scene.consoleErrors ?? []) {
    const text = message.trim();
    if (!text) continue;
    push(drafts, seen, {
      sceneId: scene.id,
      kind: 'CONSOLE',
      severity: 'major',
      label: text,
      evidence: { text },
    });
  }
}

/** 对已经采好的帧做体检。不播放、不截帧。 */
export function checkScenes(scenes: SceneCheckInput[], opts?: { turn?: number }): Issue[] {
  const turn = opts?.turn ?? 0;
  const drafts: Draft[] = [];
  const seen = new Set<string>();
  for (const scene of scenes) inspect(scene, drafts, seen);
  const counts = new Map<string, number>();
  return drafts.map((draft) => {
    const prefix = ID_PREFIX[draft.kind] ?? 'U';
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return {
      id: `${prefix}${next}`,
      scene_id: draft.sceneId,
      kind: draft.kind,
      severity: draft.severity,
      evidence: draft.evidence,
      fingerprint: fingerprint(draft.kind, draft.sceneId, draft.label, draft.tMs),
      first_turn: turn,
      last_turn: turn,
      attempts: 1,
      status: 'open',
    };
  });
}
