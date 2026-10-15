// electron/src/core/intake-bridge.ts
// Desktop 与共享收编引擎之间的桥接：以 execFile 调用 `aiws intake ...`，
// 消费同一份 `intake/v1` JSON 契约，不在 TS 侧重写扫描/比较/审核/入库规则。
//
// 设计约束（design §2.1、§4.2）：
//   1. 共享业务契约唯一：Desktop 只做 UI 与编排，规则全在 CLI 引擎里
//   2. 总库必须已初始化 AI Workspace；来源不做此要求
//   3. 取消：写取消文件（CLI 轮询）并 SIGTERM 子进程
//   4. 进度：解析 CLI 写到 stderr 的 progress JSON 行

import { execFile } from 'node:child_process';
import { promises as fs, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceError, ErrorCodes } from './errors';
import type {
  ApplyBatch,
  Candidate,
  CandidateSet,
  IntakeApplyArgs,
  IntakeBatchPayload,
  IntakePlanArgs,
  IntakeProgressEvent,
  IntakeScanArgs,
  IntakeSourceSelection,
  IntakeStatusResult,
  ReviewPlan,
  ScanBatch,
} from '../shared/intake-types';

const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_BUFFER = 64 * 1024 * 1024;

export function aiwsPath(repoPath: string): string {
  return path.join(repoPath, '.ai-workspace', 'scripts', 'aiws');
}

export function intakeDir(repoPath: string): string {
  return path.join(repoPath, '.ai-workspace', 'intake');
}

export function batchDir(repoPath: string, batchId: string): string {
  return path.join(intakeDir(repoPath), 'batches', batchId);
}

/** 总库校验：来源不做此要求，目标必须已初始化 AI Workspace */
export async function assertIntakeRepo(repoPath: string): Promise<void> {
  const aiws = aiwsPath(repoPath);
  try {
    await fs.access(aiws);
  } catch {
    throw new WorkspaceError(
      ErrorCodes.AiwsNotInstalled,
      `'${repoPath}' 未初始化 AI Workspace（缺 ${aiws}）`
    );
  }
}

export function toCliSource(s: IntakeSourceSelection): string {
  const tool = s.tool && s.tool !== 'auto' ? s.tool : 'auto';
  const scope = s.scope === 'global' ? 'global' : 'project';
  return `${s.path}:${tool}:${scope}`;
}

interface RunOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  onProgress?: (ev: IntakeProgressEvent) => void;
  operation?: IntakeProgressEvent['operation'];
  repoPath?: string;
}

interface RunResult { stdout: string; stderr: string; code: number }

function parseProgressLine(
  line: string,
  repoPath: string,
  operation: IntakeProgressEvent['operation'],
  onProgress?: (ev: IntakeProgressEvent) => void
): void {
  if (!onProgress || !line.startsWith('{')) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return;
  }
  const ev = parsed as { event?: string; message?: string; pct?: number | null };
  if (ev.event !== 'progress') return;
  onProgress({ repoPath, operation, message: ev.message ?? '', pct: ev.pct ?? null });
}

function runIntake(repoPath: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const cancelFile = path.join(os.tmpdir(), `aiws-intake-cancel-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const finalArgs = opts.signal ? [...args, '--cancel-file', cancelFile] : args;

    // AIWS_ROOT 显式指向总库：CLI 默认用 `git rev-parse` 推断，来源项目无需是 git 仓库，
    // 总库也不应因为所在目录的 git 归属而被误判（spec §2.1：总库由用户指定）。
    const child = execFile(
      aiwsPath(repoPath),
      finalArgs,
      {
        cwd: repoPath,
        env: { ...process.env, AIWS_ROOT: repoPath },
        timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
      },
      (err, stdout, stderr) => {
        cleanup();
        if (err) {
          const code = typeof (err as { code?: unknown }).code === 'number'
            ? (err as { code: number }).code
            : String((err as { message?: string }).message ?? '').includes('ENOENT') ? 127 : 1;
          resolve({ stdout: String(stdout), stderr: String(stderr), code });
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr), code: 0 });
      }
    );

    let buffer = '';
    const onStderr = (chunk: Buffer | string) => {
      buffer += String(chunk);
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        parseProgressLine(line, opts.repoPath ?? repoPath, opts.operation ?? 'scan', opts.onProgress);
      }
    };
    child.stderr?.on('data', onStderr);

    const onAbort = () => {
      try { writeFileSync(cancelFile, 'cancel\n'); } catch { /* 取消文件写失败时仍尝试终止进程 */ }
      child.kill('SIGTERM');
    };
    if (opts.signal?.aborted) {
      // 调用前就已取消：addEventListener 不会对已 abort 的 signal 触发，需要直接处理
      onAbort();
    } else {
      opts.signal?.addEventListener('abort', onAbort, { once: true });
    }

    function cleanup() {
      opts.signal?.removeEventListener('abort', onAbort);
      fs.rm(cancelFile, { force: true }).catch(() => undefined);
    }
  });
}

/** 运行并解析 JSON；CLI 在拒绝执行时也会输出结构化记录，因此优先返回已解析结果 */
async function runIntakeJson<T>(
  repoPath: string,
  args: string[],
  opts: RunOptions,
  cancelled: () => boolean
): Promise<T> {
  const res = await runIntake(repoPath, args, opts);
  const text = res.stdout.trim();
  if (text) {
    try {
      return JSON.parse(text) as T;
    } catch {
      /* 落到下方错误分支 */
    }
  }
  if (cancelled() || res.code === 143 || res.code === 130) {
    throw new WorkspaceError(ErrorCodes.IntakeCancelled, '操作已取消');
  }
  const detail = res.stderr.trim().split('\n').filter(Boolean).slice(-3).join(' / ');
  throw new WorkspaceError(
    ErrorCodes.IntakeFailed,
    detail || `aiws intake ${args[0] ?? ''} 执行失败（退出码 ${res.code}）`
  );
}

// ============================================================================
// 各步骤
// ============================================================================

export async function intakeScan(
  args: IntakeScanArgs & { signal?: AbortSignal; onProgress?: (ev: IntakeProgressEvent) => void }
): Promise<ScanBatch> {
  await assertIntakeRepo(args.repoPath);
  const cli: string[] = ['intake', 'scan', '--repo', args.repoPath, '--json'];
  for (const s of args.sources ?? []) cli.push('--source', toCliSource(s));
  for (const f of args.manualFiles ?? []) cli.push('--manual-file', f);
  for (const d of args.manualSkills ?? []) cli.push('--manual-skill', d);

  return runIntakeJson<ScanBatch>(args.repoPath, cli, {
    signal: args.signal,
    onProgress: args.onProgress,
    operation: 'scan',
    repoPath: args.repoPath,
  }, () => Boolean(args.signal?.aborted));
}

export async function intakeCompare(repoPath: string, batchId: string): Promise<CandidateSet> {
  return runIntakeJson<CandidateSet>(
    repoPath,
    ['intake', 'compare', '--repo', repoPath, '--batch', batchId, '--json'],
    { repoPath },
    () => false
  );
}

export async function intakePlan(args: IntakePlanArgs): Promise<ReviewPlan> {
  const tmp = path.join(os.tmpdir(), `aiws-intake-decisions-${process.pid}-${Date.now()}.json`);
  // 决定原样落盘：需要目标的动作（link/update/variant）必须把 target_asset_id 一起交给引擎，
  // 校验层与桥接层都不能把它丢掉，否则引擎只能靠自动匹配，用户的选择就失效了。
  await fs.writeFile(tmp, JSON.stringify({ decisions: args.decisions }, null, 2), 'utf8');
  try {
    return await runIntakeJson<ReviewPlan>(
      args.repoPath,
      ['intake', 'plan', '--repo', args.repoPath, '--batch', args.batchId, '--decisions', tmp, '--json'],
      { repoPath: args.repoPath },
      () => false
    );
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

export async function intakeApply(
  args: IntakeApplyArgs & { signal?: AbortSignal; onProgress?: (ev: IntakeProgressEvent) => void }
): Promise<ApplyBatch> {
  const cli = ['intake', 'apply', '--repo', args.repoPath, '--plan', args.planId, '--json'];
  if (args.resume) cli.push('--resume');
  return runIntakeJson<ApplyBatch>(args.repoPath, cli, {
    signal: args.signal,
    onProgress: args.onProgress,
    operation: 'apply',
    repoPath: args.repoPath,
  }, () => Boolean(args.signal?.aborted));
}

export async function intakeRollback(repoPath: string, applyId: string): Promise<ApplyBatch> {
  return runIntakeJson<ApplyBatch>(
    repoPath,
    ['intake', 'rollback', '--repo', repoPath, '--apply', applyId, '--json'],
    { repoPath },
    () => false
  );
}

export async function intakeStatus(repoPath: string, filter: { planId?: string; batchId?: string }): Promise<IntakeStatusResult> {
  const cli = ['intake', 'status', '--repo', repoPath, '--json'];
  if (filter.planId) cli.push('--plan', filter.planId);
  if (filter.batchId) cli.push('--batch', filter.batchId);
  return runIntakeJson<IntakeStatusResult>(repoPath, cli, { repoPath }, () => false);
}

// ============================================================================
// 本地记录读取（批次历史）
// ============================================================================

export async function intakeListBatches(repoPath: string): Promise<string[]> {
  const dir = path.join(intakeDir(repoPath), 'batches');
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const withScan: string[] = [];
  for (const name of entries) {
    try {
      await fs.access(path.join(dir, name, 'scan.json'));
      withScan.push(name);
    } catch {
      /* 非批次目录 */
    }
  }
  return withScan.sort().reverse();
}

async function readJsonIfPresent<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

export async function intakeReadBatch(repoPath: string, batchId: string): Promise<IntakeBatchPayload> {
  const dir = batchDir(repoPath, batchId);
  const scan = await readJsonIfPresent<ScanBatch>(path.join(dir, 'scan.json'));
  if (!scan) {
    throw new WorkspaceError(ErrorCodes.IntakeFailed, `批次不存在: ${batchId}`);
  }
  const candidates = await readJsonIfPresent<CandidateSet>(path.join(dir, 'candidates.json'));
  return { scan, candidates };
}
