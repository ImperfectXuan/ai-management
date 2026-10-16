// electron/src/core/sync-service.ts
// 功能 002：统一同步执行服务（design §4 每单元顺序、§2.3 等价恢复、§5 持久化）。
// 唯一执行入口：身份与密钥 → describe/指纹 → 输出锁 → 门控落盘 → CLI 回执 →
// 结束指纹与 keyId 复核 → 原子提交成功（含候选恢复）。记录不可写时不启动 CLI。
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ErrorCodes, WorkspaceError } from './errors';
import { SyncStatusStore, EquivalenceCandidateSnapshot } from './sync-status-store';
import { checkKeyFile, createKeyFile } from './sync-fingerprint';
import {
  SyncInputsDescriptor,
  computeUnitFingerprints,
  describeSyncInputs,
  loadDescriptorInputs,
} from './sync-inputs';
import { resolveOutputKeys, resolveUnitKey } from './sync-unit-identity';
import { syncRun } from './sync';
import { parseSyncUnitReceipt, SyncUnitReceipt } from '../shared/sync-unit-receipt';
import {
  SyncModule,
  SyncScope,
  SyncTool,
  SyncUnitKey,
  outputKeysOverlap,
  unitKeyString,
} from '../shared/sync-status';

export interface SyncUnitRef {
  tool: SyncTool;
  module: SyncModule;
  scope: SyncScope;
}

export interface SyncServiceConfig {
  store: SyncStatusStore;
  /** 本机指纹密钥路径；显式同步缺失时创建。 */
  keyFile: string;
  /** 回执临时目录（主进程 userData 下专用目录，0700）；按需创建、读取后清理。 */
  reportDir: string;
}

export interface RunUnitOptions {
  libraryRoot: string;
  /** project 必填；global 忽略（targetRoot 解析为 $HOME）。 */
  projectRoot?: string;
  tool: SyncTool;
  module: SyncModule;
  scope: SyncScope;
  /** 缺省为 <libraryRoot>/.ai-workspace/scripts/aiws */
  cliPath?: string;
  signal?: AbortSignal;
  onProgress?: (line: string, unit: SyncUnitRef, operationId: string) => void;
}

export interface RunBatchOptions {
  libraryRoot: string;
  projectRoot?: string;
  tools: SyncTool[];
  /** 顺序即执行顺序；scope=global 时自动剔除 rules。 */
  modules: SyncModule[];
  scope: SyncScope;
  cliPath?: string;
  signal?: AbortSignal;
  onProgress?: (line: string, unit: SyncUnitRef, operationId: string) => void;
  onUnitDone?: (result: SyncUnitResult) => void;
}

export type SyncUnitOutcome =
  | 'applied'
  | 'skipped'
  | 'failed'
  | 'cancelled'
  | 'record_failed'
  | 'source_changed';

export interface SyncUnitResult {
  unit: SyncUnitRef;
  outcome: SyncUnitOutcome;
  reasonCode?: string;
  receipt?: SyncUnitReceipt;
  /** 本次原子恢复的等价候选数量（仅 applied）。 */
  restoredCandidates?: number;
}

export interface SyncBatchResult {
  results: SyncUnitResult[];
  /** 首个失败/取消/落盘失败单元后停止（design §4）。 */
  stopped: boolean;
}

/**
 * 按 outputKeys 排序串行获取的键锁（design §2.1、§5）：
 * 乱序获取避免死锁；输出不重叠的单元可并行，重叠（含 Codex/Claude 共享
 * .agents/skills 及路径别名）严格互斥。
 */
class OutputLocks {
  private readonly chains = new Map<string, Promise<void>>();

  async withLocks<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
    const sorted = [...new Set(keys)].sort();
    const releases: Array<() => void> = [];
    try {
      for (const key of sorted) {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const previous = this.chains.get(key) ?? Promise.resolve();
        this.chains.set(key, previous.then(() => gate));
        await previous;
        releases.push(release);
      }
      return await fn();
    } finally {
      for (const release of releases.reverse()) release();
    }
  }
}

function isCancellation(error: unknown): boolean {
  return error instanceof WorkspaceError && error.code === ErrorCodes.SyncCancelled;
}

export interface SyncService {
  runUnit(options: RunUnitOptions): Promise<SyncUnitResult>;
  runBatch(options: RunBatchOptions): Promise<SyncBatchResult>;
}

export function createSyncService(config: SyncServiceConfig): SyncService {
  const locks = new OutputLocks();

  async function ensureReportDir(): Promise<void> {
    await fs.mkdir(config.reportDir, { recursive: true, mode: 0o700 });
  }

  /** 显式同步入口的密钥检查：缺失创建（0600），长度无效显式拒绝（需重建本机状态）。 */
  async function ensureKey(): Promise<{ keyBytes: Buffer; keyId: string }> {
    const existing = await checkKeyFile(config.keyFile);
    if (existing.status === 'ok') return { keyBytes: existing.keyBytes, keyId: existing.keyId };
    if (existing.status === 'invalid') {
      throw new WorkspaceError(ErrorCodes.InvalidArgument, `指纹密钥长度无效：${config.keyFile}；需显式重建本机同步状态`);
    }
    const created = await createKeyFile(config.keyFile);
    return { keyBytes: created.keyBytes, keyId: created.keyId };
  }

  async function safeFail(input: {
    key: SyncUnitKey;
    operationId: string;
    keyId: string;
    state: 'failed' | 'cancelled' | 'source_changed' | 'skipped' | 'record_failed' | 'interrupted';
    startedAt: string;
    endedAt: string;
    reasonCode?: string;
  }): Promise<boolean> {
    try {
      await config.store.failAttempt(input);
      return true;
    } catch {
      return false;
    }
  }

  /** skills 等价候选：在共享输出锁内重算重叠记录的当前来源指纹（design §2.3 规则 1）。 */
  async function collectOverlapCurrentFingerprints(args: {
    descriptor: SyncInputsDescriptor;
    key: SyncUnitKey;
    outputKeys: string[];
    keyBytes: Buffer;
    libraryRoot: string;
    targetRoot: string;
    cliPath?: string;
    signal?: AbortSignal;
  }): Promise<Record<string, string>> {
    const map: Record<string, string> = {};
    if (!args.descriptor.skillsPlan) return map;
    const others = await config.store.list({
      libraryRoot: args.key.libraryRoot,
      targetRoot: args.key.targetRoot,
      scope: args.key.scope,
      module: 'skills',
    });
    for (const record of others) {
      const identity = unitKeyString(record.key);
      if (identity === unitKeyString(args.key)) continue;
      if (!outputKeysOverlap(record.outputKeys, args.outputKeys)) continue;
      try {
        const descriptor = await describeSyncInputs({
          libraryRoot: args.libraryRoot,
          targetRoot: args.targetRoot,
          tool: record.key.tool,
          module: 'skills',
          scope: args.key.scope,
          cliPath: args.cliPath,
          signal: args.signal,
        });
        if (!descriptor.executable) continue;
        const loaded = await loadDescriptorInputs(descriptor, {
          libraryRoot: args.libraryRoot,
          // 依赖清单相对实际执行 CLI 的脚本目录；cliPath 可能是测试包装脚本，
          // 其 exec 的仍是库内 CLI，因此统一以库内 scripts 为基准。
          scriptsDir: path.join(args.libraryRoot, '.ai-workspace/scripts'),
        });
        map[identity] = computeUnitFingerprints(args.keyBytes, descriptor, loaded).sourceFingerprint;
      } catch {
        // 读取失败不给条目：该记录不进入候选（保守失效方向）
      }
    }
    return map;
  }

  /** 结束指纹复核（design §4 步骤 4）；来源不可读或不再可执行返回 null。 */
  async function computeEndFingerprints(args: {
    libraryRoot: string;
    targetRoot: string;
    unit: SyncUnitRef;
    keyBytes: Buffer;
    cliPath?: string;
    signal?: AbortSignal;
  }): Promise<{ sourceFingerprint: string; effectiveOutputFingerprint?: string } | null> {
    try {
      const descriptor = await describeSyncInputs({
        libraryRoot: args.libraryRoot,
        targetRoot: args.targetRoot,
        tool: args.unit.tool,
        module: args.unit.module,
        scope: args.unit.scope,
        cliPath: args.cliPath,
        signal: args.signal,
      });
      if (!descriptor.executable) return null;
      const loaded = await loadDescriptorInputs(descriptor, {
        libraryRoot: args.libraryRoot,
        scriptsDir: path.join(args.libraryRoot, '.ai-workspace/scripts'),
      });
      return computeUnitFingerprints(args.keyBytes, descriptor, loaded);
    } catch {
      return null;
    }
  }

  async function readReceipt(reportFile: string, expected: {
    operationId: string; tool: SyncTool; module: SyncModule; scope: SyncScope;
  }): Promise<SyncUnitReceipt | undefined> {
    try {
      const raw = await fs.readFile(reportFile, 'utf8');
      return parseSyncUnitReceipt(raw, expected);
    } catch {
      return undefined;
    }
  }

  async function runUnit(options: RunUnitOptions): Promise<SyncUnitResult> {
    const unit: SyncUnitRef = { tool: options.tool, module: options.module, scope: options.scope };
    const failEarly = (reasonCode: string): SyncUnitResult => ({ unit, outcome: 'failed', reasonCode });
    const skipEarly = (reasonCode: string): SyncUnitResult => ({ unit, outcome: 'skipped', reasonCode });

    if (options.signal?.aborted) return { unit, outcome: 'cancelled', reasonCode: 'cancelled' };

    // 步骤 1：身份（输入无效不接触目标）
    const identity = await resolveUnitKey({
      libraryPath: options.libraryRoot,
      projectPath: options.projectRoot,
      tool: options.tool,
      module: options.module,
      scope: options.scope,
    });
    if (!identity.ok) return skipEarly(identity.reason);
    const targetRoot = identity.key.targetRoot;

    const describeOptions = {
      libraryRoot: options.libraryRoot,
      targetRoot,
      tool: options.tool,
      module: options.module,
      scope: options.scope,
      cliPath: options.cliPath,
      signal: options.signal,
    };
    // 依赖相对库内 scripts（与执行 CLI 同源；cliPath 允许是测试包装脚本）
    const scriptsDir = path.join(options.libraryRoot, '.ai-workspace/scripts');

    let descriptor: SyncInputsDescriptor;
    try {
      descriptor = await describeSyncInputs(describeOptions);
    } catch (error) {
      if (isCancellation(error) || options.signal?.aborted) return { unit, outcome: 'cancelled', reasonCode: 'cancelled' };
      return failEarly('describe_failed');
    }
    if (!descriptor.executable) return skipEarly(descriptor.reasonCode ?? 'not_executable');
    if (options.signal?.aborted) return { unit, outcome: 'cancelled', reasonCode: 'cancelled' };

    // 不可执行单元到此为止：不创建密钥、不写状态、不取锁
    let key: { keyBytes: Buffer; keyId: string };
    try {
      key = await ensureKey();
    } catch (error) {
      return failEarly(error instanceof WorkspaceError && error.code === ErrorCodes.InvalidArgument ? 'key_invalid' : 'key_error');
    }

    let start: { sourceFingerprint: string; effectiveOutputFingerprint?: string };
    let outputKeys: string[];
    try {
      const loaded = await loadDescriptorInputs(descriptor, { libraryRoot: options.libraryRoot, scriptsDir });
      start = computeUnitFingerprints(key.keyBytes, descriptor, loaded);
      outputKeys = await resolveOutputKeys(descriptor.outputKeys);
      if (outputKeys.length === 0) return failEarly('no_outputs');
    } catch {
      return failEarly('inputs_unreadable');
    }

    // 步骤 2–6：输出锁内执行
    return locks.withLocks(outputKeys, async () => {
      const operationId = randomUUID();
      const startedAt = new Date().toISOString();

      const currentSourceFingerprints = await collectOverlapCurrentFingerprints({
        descriptor, key: identity.key, outputKeys, keyBytes: key.keyBytes,
        libraryRoot: options.libraryRoot, targetRoot, cliPath: options.cliPath, signal: options.signal,
      });

      let candidates: EquivalenceCandidateSnapshot[];
      try {
        candidates = await config.store.beginWrite({
          key: identity.key,
          outputKeys,
          operationId,
          keyId: key.keyId,
          startedAt,
          effectiveOutputFingerprint: start.effectiveOutputFingerprint ?? null,
          currentSourceFingerprints,
        });
      } catch {
        // 记录不可写时不启动 CLI（design §4 步骤 2）
        return { unit, outcome: 'failed', reasonCode: 'record_unwritable' };
      }
      if (options.signal?.aborted) {
        const persisted = await safeFail({
          key: identity.key, operationId, keyId: key.keyId, state: 'cancelled',
          startedAt, endedAt: new Date().toISOString(), reasonCode: 'cancelled',
        });
        return persisted
          ? { unit, outcome: 'cancelled', reasonCode: 'cancelled' }
          : { unit, outcome: 'record_failed', reasonCode: 'record_unwritable' };
      }

      // 步骤 3：执行 CLI（回执模式，逐行转发进度）
      await ensureReportDir();
      const reportFile = path.join(config.reportDir, `${operationId}.json`);
      let execError: unknown;
      try {
        for await (const line of syncRun(targetRoot, {
          libraryRoot: options.libraryRoot,
          cliPath: options.cliPath,
          scope: options.scope,
          tool: options.tool,
          only: options.module,
          reportFile,
          operationId,
        }, options.signal)) {
          options.onProgress?.(line, unit, operationId);
        }
      } catch (error) {
        execError = error;
      }

      const receiptExpected = { operationId, tool: options.tool, module: options.module, scope: options.scope };
      const finishWithoutSuccess = async (
        state: 'failed' | 'cancelled' | 'source_changed' | 'skipped' | 'record_failed',
        reasonCode: string,
        receipt?: SyncUnitReceipt,
      ): Promise<SyncUnitResult> => {
        const persisted = await safeFail({
          key: identity.key, operationId, keyId: key.keyId, state,
          startedAt, endedAt: new Date().toISOString(), reasonCode,
        });
        if (!persisted) return { unit, outcome: 'record_failed', reasonCode: 'record_unwritable' };
        const outcome: SyncUnitOutcome =
          state === 'cancelled' ? 'cancelled'
          : state === 'source_changed' ? 'source_changed'
          : state === 'skipped' ? 'skipped'
          : state === 'record_failed' ? 'record_failed'
          : 'failed';
        return { unit, outcome, reasonCode, receipt };
      };

      try {
        // 取消优先：进程组已终止
        if (isCancellation(execError) || (options.signal?.aborted && execError !== undefined)) {
          return await finishWithoutSuccess('cancelled', 'cancelled');
        }
        if (execError !== undefined) {
          // 非零退出优先失败（design §4）：回执即使为 applied/skipped 也不得提交成功；
          // 回执自带的 reasonCode 仍用于诊断（如 invalid_config）。
          const receipt = await readReceipt(reportFile, receiptExpected);
          return await finishWithoutSuccess('failed', receipt?.reasonCode ?? 'cli_failed', receipt);
        }

        const receipt = await readReceipt(reportFile, receiptExpected);
        if (!receipt) return await finishWithoutSuccess('failed', 'receipt_invalid');
        if (receipt.outcome === 'skipped') return await finishWithoutSuccess('skipped', receipt.reasonCode ?? 'skipped', receipt);
        if (receipt.outcome === 'failed') return await finishWithoutSuccess('failed', receipt.reasonCode ?? 'failed', receipt);

        // 步骤 4：applied 回执通过后，复核 keyId 与结束指纹
        const keyNow = await checkKeyFile(config.keyFile);
        if (keyNow.status !== 'ok' || keyNow.keyId !== key.keyId) {
          // 运行中换密钥：不提交、不恢复候选；用原 keyId 记录尝试（Store 拒绝改写）
          return await finishWithoutSuccess('failed', 'key_changed', receipt);
        }
        const end = await computeEndFingerprints({
          libraryRoot: options.libraryRoot, targetRoot, unit, keyBytes: keyNow.keyBytes,
          cliPath: options.cliPath, signal: options.signal,
        });
        if (!end) return await finishWithoutSuccess('source_changed', 'source_unreadable', receipt);
        if (end.sourceFingerprint !== start.sourceFingerprint ||
            (end.effectiveOutputFingerprint ?? null) !== (start.effectiveOutputFingerprint ?? null)) {
          return await finishWithoutSuccess('source_changed', 'source_changed', receipt);
        }

        // 步骤 5–6：原子提交成功（含等价候选恢复）；失败显示 record_failed，磁盘保持 running
        try {
          const restored = await config.store.commitSuccess({
            key: identity.key,
            operationId,
            keyId: key.keyId,
            sourceFingerprint: start.sourceFingerprint,
            effectiveOutputFingerprint: start.effectiveOutputFingerprint ?? null,
            startedAt,
            completedAt: receipt.completedAt as string,
            candidates,
          });
          return { unit, outcome: 'applied', receipt, restoredCandidates: restored };
        } catch {
          return { unit, outcome: 'record_failed', reasonCode: 'record_unwritable' };
        }
      } finally {
        await fs.rm(reportFile, { force: true }).catch(() => undefined);
      }
    });
  }

  async function runBatch(options: RunBatchOptions): Promise<SyncBatchResult> {
    const modules = options.scope === 'global'
      ? options.modules.filter((module) => module !== 'rules')
      : [...options.modules];
    const results: SyncUnitResult[] = [];
    let stopped = false;

    for (const module of modules) {
      for (const tool of options.tools) {
        if (options.signal?.aborted) {
          stopped = true;
          break;
        }
        const result = await runUnit({
          libraryRoot: options.libraryRoot,
          projectRoot: options.projectRoot,
          tool,
          module,
          scope: options.scope,
          cliPath: options.cliPath,
          signal: options.signal,
          onProgress: options.onProgress,
        });
        results.push(result);
        options.onUnitDone?.(result);
        if (result.outcome !== 'applied' && result.outcome !== 'skipped') {
          stopped = true;
          break;
        }
      }
      if (stopped) break;
    }
    return { results, stopped };
  }

  return { runUnit, runBatch };
}
