// electron/src/shared/sync-status.ts
// 功能 002：本机同步版本状态的共享契约。主进程是唯一写入方，渲染层只读展示。
// 依据 docs/specs/002-sync-status/design.md §2、§3.1、§5。

export const SYNC_STATUS_SCHEMA_VERSION = 1 as const;
export const FINGERPRINT_VERSION = 1 as const;
export const KEY_ID_PATTERN = /^sha256:[0-9a-f]{64}$/;

export type SyncTool = 'codex' | 'claude' | 'cursor' | 'trae';
export type SyncModule = 'rules' | 'skills' | 'mcp';
export type SyncScope = 'project' | 'global';

export type VersionState = 'untracked' | 'pending' | 'current' | 'disabled' | 'unsupported' | 'unknown';

export type AttemptState =
  | 'never'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'source_changed'
  | 'skipped'
  | 'record_failed';

/** 密钥身份问题；查询时先于来源指纹比较，未知或错误优先于 current。 */
export type KeyProblemCode = 'key_missing' | 'key_invalid' | 'key_changed';

export interface SyncUnitKey {
  libraryRoot: string;
  targetRoot: string;
  tool: SyncTool;
  module: SyncModule;
  scope: SyncScope;
}

export interface SyncLastSuccess {
  fingerprintVersion: 1;
  keyId: string;
  sourceFingerprint: string;
  /** 首版 Skills 必填才能参与等价恢复；其他模块不用于等价。 */
  effectiveOutputFingerprint?: string;
  completedAt: string;
}

export interface SyncLastAttempt {
  operationId: string;
  keyId: string;
  state: AttemptState;
  startedAt: string;
  endedAt?: string;
  reasonCode?: string;
}

export interface SyncRecord {
  key: SyncUnitKey;
  outputKeys: string[];
  needsResync: boolean;
  lastSuccess?: SyncLastSuccess;
  lastAttempt?: SyncLastAttempt;
}

export interface SyncStatusFile {
  schemaVersion: 1;
  records: SyncRecord[];
}

export type KeyStatus = 'ok' | 'missing' | 'invalid';

/** 单元键的稳定序列化，用于映射与相等判断。 */
export function unitKeyString(key: SyncUnitKey): string {
  return JSON.stringify([key.libraryRoot, key.targetRoot, key.tool, key.module, key.scope]);
}

export function unitKeysEqual(a: SyncUnitKey, b: SyncUnitKey): boolean {
  return unitKeyString(a) === unitKeyString(b);
}

function normalizePathSet(paths: readonly string[]): string[] {
  return [...new Set(paths)].sort();
}

/** 完整集合相等：只有部分重叠不算共享全部输出。 */
export function outputKeySetsEqual(a: readonly string[], b: readonly string[]): boolean {
  const left = normalizePathSet(a);
  const right = normalizePathSet(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function outputKeysOverlap(a: readonly string[], b: readonly string[]): boolean {
  const right = new Set(b);
  return a.some((value) => right.has(value));
}

/**
 * 由密钥检查结果与记录中的 keyId 得出身份问题。
 * 无基线时的 key_missing/invalid 由 resolveVersionState 先行判定为 untracked，
 * 不把“从未同步过”误报成密钥故障。
 */
export function keyProblemFor(
  baselineKeyId: string | undefined,
  currentKeyId: string | null,
  keyStatus: KeyStatus
): KeyProblemCode | null {
  if (keyStatus === 'missing') return 'key_missing';
  if (keyStatus === 'invalid') return 'key_invalid';
  if (currentKeyId === null) return 'key_invalid';
  if (baselineKeyId === undefined) return null;
  return baselineKeyId === currentKeyId ? null : 'key_changed';
}

/** 成功基线必须可信：keyId 格式、算法版本与时间戳有效；缺失 keyId 的实验性记录降级为无基线。 */
export function isTrustedSuccess(success: SyncLastSuccess | undefined): success is SyncLastSuccess {
  if (!success) return false;
  if (success.fingerprintVersion !== FINGERPRINT_VERSION) return false;
  if (!KEY_ID_PATTERN.test(success.keyId)) return false;
  if (typeof success.sourceFingerprint !== 'string' || success.sourceFingerprint.length === 0) return false;
  return Number.isFinite(Date.parse(success.completedAt));
}

/** 只有携带有效输出指纹的 Skills 成功记录才参与等价快照与恢复。 */
export function canParticipateEquivalence(record: SyncRecord): boolean {
  if (record.key.module !== 'skills') return false;
  if (!isTrustedSuccess(record.lastSuccess)) return false;
  return typeof record.lastSuccess.effectiveOutputFingerprint === 'string'
    && record.lastSuccess.effectiveOutputFingerprint.length > 0;
}

export interface VersionStateContext {
  applicability?: 'applicable' | 'disabled' | 'unsupported';
  record?: SyncRecord | null;
  /** 由 checkKey 与记录 keyId 派生；null 表示无问题。 */
  keyProblem?: KeyProblemCode | null;
  /** 当前来源指纹；null 表示来源不可读取。 */
  currentSourceFingerprint?: string | null;
  reasonCode?: string;
}

export interface VersionStateResult {
  state: VersionState;
  reasonCode?: string;
}

/**
 * 单元版本状态归约（design §2.2）：
 * 适用性 → 基线存在性 → 密钥身份 → 来源可读性 → needsResync → 指纹相等。
 * 密钥身份先于指纹比较，错误优先于 current；本函数只读，绝不清除 needsResync。
 */
export function resolveVersionState(ctx: VersionStateContext): VersionStateResult {
  const applicability = ctx.applicability ?? 'applicable';
  if (applicability === 'disabled') return { state: 'disabled', reasonCode: 'module_disabled' };
  if (applicability === 'unsupported') return { state: 'unsupported', reasonCode: 'tool_unsupported' };

  const success = isTrustedSuccess(ctx.record?.lastSuccess) ? ctx.record?.lastSuccess : undefined;
  if (!success) return { state: 'untracked' };

  if (ctx.keyProblem) return { state: 'unknown', reasonCode: ctx.keyProblem };
  if (ctx.currentSourceFingerprint === null || ctx.currentSourceFingerprint === undefined) {
    return { state: 'unknown', reasonCode: ctx.reasonCode ?? 'source_unreadable' };
  }
  if (ctx.record?.needsResync) return { state: 'pending', reasonCode: 'needs_resync' };
  if (ctx.currentSourceFingerprint === success.sourceFingerprint) return { state: 'current' };
  return { state: 'pending', reasonCode: 'source_changed' };
}
