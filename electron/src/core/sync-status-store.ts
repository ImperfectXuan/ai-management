// electron/src/core/sync-status-store.ts
// 功能 002：本机同步状态持久化与共享输出等价判定生命周期（design §2.3、§4、§5）。
// 主进程单一 Store 排队写入：同目录临时文件 + 原子 rename，0600；损坏/未知 schema 显式报错并保留原文件。
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ErrorCodes, WorkspaceError } from './errors';
import {
  KEY_ID_PATTERN,
  SYNC_STATUS_SCHEMA_VERSION,
  SyncLastAttempt,
  SyncLastSuccess,
  SyncRecord,
  SyncStatusFile,
  SyncUnitKey,
  canParticipateEquivalence,
  isTrustedSuccess,
  outputKeySetsEqual,
  outputKeysOverlap,
  unitKeyString,
} from '../shared/sync-status';

/** 等价候选快照：失效前的可信成功状态，用于成功提交时的原子恢复核对。 */
export interface EquivalenceCandidateSnapshot {
  recordKey: SyncUnitKey;
  outputKeys: string[];
  lastSuccess: SyncLastSuccess;
  lastAttempt?: SyncLastAttempt;
}

export interface BeginWriteInput {
  key: SyncUnitKey;
  outputKeys: string[];
  operationId: string;
  keyId: string;
  startedAt: string;
  /** Skills 实际分发计划指纹；缺省表示本次写入不启用等价恢复。 */
  effectiveOutputFingerprint?: string | null;
  /**
   * 查询期算出的各记录“当前来源指纹”，用于校验候选写入前本来为 current；
   * 缺条目或与基线不等的记录不进入候选（来源已变、未记录的工具不参与）。
   */
  currentSourceFingerprints?: Record<string, string>;
}

export interface CommitSuccessInput {
  key: SyncUnitKey;
  operationId: string;
  /** 提交时重新核对的密钥身份；与写入开始时不一致则拒绝提交（运行中换密钥）。 */
  keyId: string;
  sourceFingerprint: string;
  effectiveOutputFingerprint?: string | null;
  startedAt: string;
  completedAt: string;
  candidates: EquivalenceCandidateSnapshot[];
}

export interface FailAttemptInput {
  key: SyncUnitKey;
  operationId: string;
  keyId: string;
  state: 'failed' | 'cancelled' | 'source_changed' | 'skipped' | 'record_failed' | 'interrupted';
  startedAt: string;
  endedAt: string;
  reasonCode?: string;
}

export interface StatusFilter {
  libraryRoot?: string;
  targetRoot?: string;
  scope?: SyncRecord['key']['scope'];
  tool?: SyncRecord['key']['tool'];
  module?: SyncRecord['key']['module'];
}

function invalid(message: string): WorkspaceError {
  return new WorkspaceError(ErrorCodes.SyncStatusInvalid, message);
}

function requireRecordShape(raw: unknown, index: number): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw invalid(`同步状态记录 #${index} 不是对象`);
  }
  return raw as Record<string, unknown>;
}

function requireKey(raw: unknown, index: number): SyncUnitKey {
  const record = requireRecordShape(raw, index);
  const key = record.key;
  if (typeof key !== 'object' || key === null) throw invalid(`同步状态记录 #${index} 缺少单元键`);
  const { libraryRoot, targetRoot, tool, module, scope } = key as Record<string, unknown>;
  const valid =
    typeof libraryRoot === 'string' && path.isAbsolute(libraryRoot) &&
    typeof targetRoot === 'string' && path.isAbsolute(targetRoot) &&
    ['codex', 'claude', 'cursor', 'trae'].includes(String(tool)) &&
    ['rules', 'skills', 'mcp'].includes(String(module)) &&
    ['project', 'global'].includes(String(scope));
  if (!valid) throw invalid(`同步状态记录 #${index} 单元键无效`);
  return {
    libraryRoot: libraryRoot as string,
    targetRoot: targetRoot as string,
    tool: tool as SyncUnitKey['tool'],
    module: module as SyncUnitKey['module'],
    scope: scope as SyncUnitKey['scope'],
  };
}

function requireStringArray(raw: unknown, index: number, field: string): string[] {
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw invalid(`同步状态记录 #${index} 的 ${field} 无效`);
  }
  return [...raw] as string[];
}

function parseAttempt(raw: unknown, index: number): SyncLastAttempt | undefined {
  if (raw === undefined || raw === null) return undefined;
  const attempt = requireRecordShape(raw, index);
  const { operationId, keyId, state, startedAt, endedAt, reasonCode } = attempt;
  const valid =
    typeof operationId === 'string' && operationId.length > 0 &&
    typeof keyId === 'string' && KEY_ID_PATTERN.test(keyId) &&
    typeof state === 'string' && state.length > 0 &&
    typeof startedAt === 'string' && Number.isFinite(Date.parse(startedAt)) &&
    (endedAt === undefined || (typeof endedAt === 'string' && Number.isFinite(Date.parse(endedAt)))) &&
    (reasonCode === undefined || typeof reasonCode === 'string');
  if (!valid) throw invalid(`同步状态记录 #${index} 的最近尝试无效`);
  return { operationId, keyId, state, startedAt, endedAt, reasonCode } as SyncLastAttempt;
}

/**
 * lastSuccess 缺 keyId、格式错误、版本不符或时间戳无效时降级为“无可信成功”，
 * 保留记录本身；不把实验性数据当作成功基线，也不整体判文件损坏。
 */
function demoteUntrustedSuccess(raw: unknown, index: number): SyncLastSuccess | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw invalid(`同步状态记录 #${index} 的成功记录无效`);
  const success = raw as Record<string, unknown>;
  const candidate: SyncLastSuccess = {
    fingerprintVersion: 1,
    keyId: String(success.keyId ?? ''),
    sourceFingerprint: String(success.sourceFingerprint ?? ''),
    effectiveOutputFingerprint:
      typeof success.effectiveOutputFingerprint === 'string' && success.effectiveOutputFingerprint.length > 0
        ? success.effectiveOutputFingerprint
        : undefined,
    completedAt: String(success.completedAt ?? ''),
  };
  if (success.fingerprintVersion !== undefined && success.fingerprintVersion !== 1) return undefined;
  if (!isTrustedSuccess(candidate)) return undefined;
  return candidate;
}

function parseStatus(raw: string): SyncStatusFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw invalid('同步状态文件不是有效 JSON，已保留原文件，请使用“重建本机同步记录”');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw invalid('同步状态文件结构无效，已保留原文件');
  }
  const file = parsed as Record<string, unknown>;
  if (file.schemaVersion !== SYNC_STATUS_SCHEMA_VERSION) {
    throw invalid(`不支持的同步状态版本：${String(file.schemaVersion)}，已保留原文件`);
  }
  if (!Array.isArray(file.records)) throw invalid('同步状态文件缺少记录列表');
  const seen = new Set<string>();
  const records: SyncRecord[] = file.records.map((raw, index) => {
    const record = requireRecordShape(raw, index);
    const key = requireKey(record, index);
    const identity = unitKeyString(key);
    if (seen.has(identity)) throw invalid(`同步状态记录重复：${identity}`);
    seen.add(identity);
    const needsResync = record.needsResync;
    if (typeof needsResync !== 'boolean') throw invalid(`同步状态记录 #${index} 的 needsResync 无效`);
    return {
      key,
      outputKeys: requireStringArray(record.outputKeys, index, 'outputKeys'),
      needsResync,
      lastSuccess: demoteUntrustedSuccess(record.lastSuccess, index),
      lastAttempt: parseAttempt(record.lastAttempt, index),
    };
  });
  return { schemaVersion: SYNC_STATUS_SCHEMA_VERSION, records };
}

export class SyncStatusStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  /** 排队执行，保证同一主进程串行读写；前序失败不阻断后续操作。 */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = () => fn();
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async loadUnlocked(): Promise<SyncStatusFile> {
    let raw: string;
    try {
      raw = await fs.readFile(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { schemaVersion: SYNC_STATUS_SCHEMA_VERSION, records: [] };
      }
      throw error;
    }
    return parseStatus(raw);
  }

  private async saveUnlocked(status: SyncStatusFile): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(status, null, 2) + '\n', { mode: 0o600 });
    await fs.rename(temp, this.file).catch(async (error) => {
      await fs.unlink(temp).catch(() => undefined);
      throw error;
    });
  }

  async load(): Promise<SyncStatusFile> {
    return this.exclusive(() => this.loadUnlocked());
  }

  async get(key: SyncUnitKey): Promise<SyncRecord | undefined> {
    const identity = unitKeyString(key);
    return this.exclusive(async () => {
      const status = await this.loadUnlocked();
      return status.records.find((record) => unitKeyString(record.key) === identity);
    });
  }

  async list(filter: StatusFilter = {}): Promise<SyncRecord[]> {
    return this.exclusive(async () => {
      const status = await this.loadUnlocked();
      return status.records.filter((record) => {
        if (filter.libraryRoot !== undefined && record.key.libraryRoot !== filter.libraryRoot) return false;
        if (filter.targetRoot !== undefined && record.key.targetRoot !== filter.targetRoot) return false;
        if (filter.scope !== undefined && record.key.scope !== filter.scope) return false;
        if (filter.tool !== undefined && record.key.tool !== filter.tool) return false;
        if (filter.module !== undefined && record.key.module !== filter.module) return false;
        return true;
      });
    });
  }

  /**
   * 写入前门控（design §2.3 规则 1–2）：在本函数内先取等价候选快照，
   * 再把执行单元与所有重叠输出记录持久化为 needsResync=true（执行单元同时落 running）。
   * 单次原子落盘后才返回候选，调用方拿不到候选就不得启动 CLI。
   */
  async beginWrite(input: BeginWriteInput): Promise<EquivalenceCandidateSnapshot[]> {
    return this.exclusive(async () => {
      const status = await this.loadUnlocked();
      const executorIdentity = unitKeyString(input.key);
      const candidates: EquivalenceCandidateSnapshot[] = [];

      if (input.effectiveOutputFingerprint) {
        for (const record of status.records) {
          if (unitKeyString(record.key) === executorIdentity) continue;
          if (record.key.module !== 'skills') continue;
          if (record.key.libraryRoot !== input.key.libraryRoot) continue;
          if (record.key.targetRoot !== input.key.targetRoot) continue;
          if (record.key.scope !== input.key.scope) continue;
          if (record.needsResync) continue;
          if (!canParticipateEquivalence(record)) continue;
          if (!outputKeySetsEqual(record.outputKeys, input.outputKeys)) continue;
          const success = record.lastSuccess as SyncLastSuccess;
          if (success.keyId !== input.keyId) continue;
          if (success.effectiveOutputFingerprint !== input.effectiveOutputFingerprint) continue;
          const current = input.currentSourceFingerprints?.[unitKeyString(record.key)];
          if (current === undefined || current !== success.sourceFingerprint) continue;
          candidates.push({
            recordKey: { ...record.key },
            outputKeys: [...record.outputKeys],
            lastSuccess: { ...success },
            lastAttempt: record.lastAttempt ? { ...record.lastAttempt } : undefined,
          });
        }
      }

      const now = input.startedAt;
      for (const record of status.records) {
        const identity = unitKeyString(record.key);
        if (identity === executorIdentity) {
          record.outputKeys = [...input.outputKeys];
          record.needsResync = true;
          record.lastAttempt = {
            operationId: input.operationId,
            keyId: input.keyId,
            state: 'running',
            startedAt: now,
          };
          continue;
        }
        if (outputKeysOverlap(record.outputKeys, input.outputKeys)) {
          record.needsResync = true;
        }
      }
      if (!status.records.some((record) => unitKeyString(record.key) === executorIdentity)) {
        status.records.push({
          key: { ...input.key },
          outputKeys: [...input.outputKeys],
          needsResync: true,
          lastAttempt: {
            operationId: input.operationId,
            keyId: input.keyId,
            state: 'running',
            startedAt: now,
          },
        });
      }

      await this.saveUnlocked(status);
      return candidates;
    });
  }

  /**
   * 成功提交（design §2.3 规则 3）：执行单元成功与仍可信候选的恢复在同一次原子写入中。
   * 只恢复候选的 needsResync，保留其原 lastSuccess/lastAttempt；绝不为未执行工具创建成功记录。
   */
  async commitSuccess(input: CommitSuccessInput): Promise<number> {
    return this.exclusive(async () => {
      const status = await this.loadUnlocked();
      const executorIdentity = unitKeyString(input.key);
      const executor = status.records.find((record) => unitKeyString(record.key) === executorIdentity);
      if (!executor || !executor.lastAttempt || executor.lastAttempt.operationId !== input.operationId) {
        throw new WorkspaceError(ErrorCodes.SyncFailed, '找不到对应的写入尝试记录，拒绝提交成功状态');
      }
      if (executor.lastAttempt.state !== 'running') {
        throw new WorkspaceError(ErrorCodes.SyncFailed, `写入尝试状态为 ${executor.lastAttempt.state}，拒绝提交成功状态`);
      }
      if (executor.lastAttempt.keyId !== input.keyId) {
        // 运行期间密钥被原位替换：不更新成功记录、不恢复等价候选。
        throw new WorkspaceError(ErrorCodes.SyncFailed, 'key_changed：运行期间指纹密钥已更换，拒绝提交成功状态');
      }

      executor.needsResync = false;
      executor.lastSuccess = {
        fingerprintVersion: 1,
        keyId: input.keyId,
        sourceFingerprint: input.sourceFingerprint,
        effectiveOutputFingerprint: input.effectiveOutputFingerprint ?? undefined,
        completedAt: input.completedAt,
      };
      executor.lastAttempt = {
        operationId: input.operationId,
        keyId: input.keyId,
        state: 'succeeded',
        startedAt: input.startedAt,
        endedAt: input.completedAt,
      };

      let restored = 0;
      for (const candidate of input.candidates) {
        const identity = unitKeyString(candidate.recordKey);
        if (identity === executorIdentity) continue;
        const record = status.records.find((item) => unitKeyString(item.key) === identity);
        if (!record || !record.needsResync) continue;
        if (record.lastSuccess?.keyId !== input.keyId) continue;
        if (!isDeepStrictEqual(record.outputKeys, candidate.outputKeys)) continue;
        if (!isDeepStrictEqual(record.lastSuccess, candidate.lastSuccess)) continue;
        if (!isDeepStrictEqual(record.lastAttempt, candidate.lastAttempt)) continue;
        record.needsResync = false;
        restored += 1;
      }

      await this.saveUnlocked(status);
      return restored;
    });
  }

  /** 失败/取消/中断等终态：只更新执行单元的最近尝试，不覆盖 lastSuccess，不恢复任何候选。 */
  async failAttempt(input: FailAttemptInput): Promise<void> {
    return this.exclusive(async () => {
      const status = await this.loadUnlocked();
      const identity = unitKeyString(input.key);
      const record = status.records.find((item) => unitKeyString(item.key) === identity);
      if (!record || !record.lastAttempt || record.lastAttempt.operationId !== input.operationId) {
        throw new WorkspaceError(ErrorCodes.SyncFailed, '找不到对应的写入尝试记录，拒绝记录失败结果');
      }
      if (record.lastAttempt.state !== 'running') {
        throw new WorkspaceError(ErrorCodes.SyncFailed, `写入尝试状态为 ${record.lastAttempt.state}，拒绝覆盖为 ${input.state}`);
      }
      if (record.lastAttempt.keyId !== input.keyId) {
        throw new WorkspaceError(ErrorCodes.SyncFailed, 'key_changed：运行期间指纹密钥已更换，拒绝记录结果');
      }
      record.needsResync = true;
      record.lastAttempt = {
        operationId: input.operationId,
        keyId: input.keyId,
        state: input.state,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        reasonCode: input.reasonCode,
      };
      await this.saveUnlocked(status);
    });
  }

  /** 启动恢复：残留 running 改为 interrupted 并标记 needsResync；返回恢复条数。 */
  async recoverInterrupted(now: string): Promise<number> {
    return this.exclusive(async () => {
      const status = await this.loadUnlocked();
      let recovered = 0;
      for (const record of status.records) {
        if (record.lastAttempt?.state !== 'running') continue;
        record.needsResync = true;
        record.lastAttempt = { ...record.lastAttempt, state: 'interrupted', endedAt: now };
        recovered += 1;
      }
      if (recovered > 0) await this.saveUnlocked(status);
      return recovered;
    });
  }
}
