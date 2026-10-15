// electron/src/core/sync-fingerprint.ts
// 功能 002：本机密钥、keyId 派生与 HMAC 指纹（design §3.1、§2.3）。
// 密钥只在显式同步时创建；查询只读检查，绝不生成密钥。
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ErrorCodes, WorkspaceError } from './errors';
import {
  FINGERPRINT_VERSION,
  KeyStatus,
  SyncModule,
  SyncScope,
  SyncTool,
} from '../shared/sync-status';

export const KEY_BYTES = 32;

export interface KeyCheckOk {
  status: 'ok';
  keyBytes: Buffer;
  keyId: string;
}

export interface KeyCheckProblem {
  status: 'missing' | 'invalid';
}

export type KeyCheckResult = KeyCheckOk | KeyCheckProblem;

/** keyId = "sha256:" + SHA-256(原始 32 字节密钥)；是密钥身份摘要，不是配置摘要。 */
export function deriveKeyId(keyBytes: Buffer): string {
  if (keyBytes.length !== KEY_BYTES) {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, `指纹密钥长度必须为 ${KEY_BYTES} 字节，实际 ${keyBytes.length}`);
  }
  return 'sha256:' + createHash('sha256').update(keyBytes).digest('hex');
}

/** 只读检查：ENOENT 为 key_missing，长度不符为 key_invalid；不在任何路径创建密钥。 */
export async function checkKeyFile(file: string): Promise<KeyCheckResult> {
  let raw: Buffer;
  try {
    raw = await fs.readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' };
    throw error;
  }
  if (raw.length !== KEY_BYTES) return { status: 'invalid' };
  return { status: 'ok', keyBytes: raw, keyId: deriveKeyId(raw) };
}

/**
 * 首次显式同步创建 32 字节随机密钥（0600，同目录临时文件 + rename）。
 * 已存在则原样返回，绝不原位替换——替换必须由用户显式重建本机状态触发。
 */
export async function createKeyFile(file: string): Promise<KeyCheckOk> {
  const existing = await checkKeyFile(file);
  if (existing.status === 'ok') return existing;
  if (existing.status === 'invalid') {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, `指纹密钥长度无效：${file}；需显式重建本机同步状态`);
  }
  const keyBytes = randomBytes(KEY_BYTES);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, keyBytes, { mode: 0o600 });
  // 用 link 而非 rename：rename 在 POSIX 会静默替换已有密钥，违背“绝不原位替换”。
  await fs.link(temp, file).catch(async (error: NodeJS.ErrnoException) => {
    await fs.unlink(temp).catch(() => undefined);
    if (error.code !== 'EEXIST') throw error;
    const raced = await checkKeyFile(file);
    if (raced.status !== 'ok') {
      throw new WorkspaceError(ErrorCodes.InvalidArgument, `指纹密钥已存在但长度无效：${file}；需显式重建本机同步状态`);
    }
  });
  await fs.unlink(temp).catch(() => undefined);
  const created = await checkKeyFile(file);
  if (created.status !== 'ok') {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, `指纹密钥创建后不可读：${file}`);
  }
  return created;
}

/**
 * 规范化编码：对象键按 UTF-8 字节序排列、数组保留顺序、规范 JSON 分段，
 * 禁止无分隔字符串拼接；文本按实际字节进入 HMAC，不做 trim 或换行归一。
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'object') {
    if (Array.isArray(value)) {
      return '[' + value.map((item) => canonicalJson(item)).join(',') + ']';
    }
    if (value === null) return 'null';
    const source = value as Record<string, unknown>;
    const keys = Object.keys(source)
      .filter((key) => source[key] !== undefined)
      .sort((a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')));
    return '{' + keys.map((key) => JSON.stringify(key) + ':' + canonicalJson(source[key])).join(',') + '}';
  }
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new WorkspaceError(ErrorCodes.InvalidArgument, '指纹载荷不允许非有限数字');
    }
    return JSON.stringify(value);
  }
  throw new WorkspaceError(ErrorCodes.InvalidArgument, `指纹载荷包含不可序列化类型：${typeof value}`);
}

export function hmacSha256(keyBytes: Buffer, payload: unknown): string {
  return createHmac('sha256', keyBytes).update(canonicalJson(payload), 'utf8').digest('hex');
}

export interface SourceFingerprintPayload {
  unit: { tool: SyncTool; module: SyncModule; scope: SyncScope };
  inputs: unknown;
  behavior?: unknown;
  generatorDeps?: unknown;
}

/** 单元来源指纹：载荷含 tool，因此不同工具即使输入相同也不同；等价判定不得直接复用。 */
export function computeSourceFingerprint(keyBytes: Buffer, payload: SourceFingerprintPayload): string {
  return hmacSha256(keyBytes, { fingerprintVersion: FINGERPRINT_VERSION, kind: 'source', payload });
}

export type SkillsLinkStrategy = 'symlink' | 'copy';

export interface SkillsPlanEntry {
  /** 技能名相对路径，作为集合排序键。 */
  relativePath: string;
  targetPath: string;
  sourcePath: string;
  sourceVersion: string;
  strategy: SkillsLinkStrategy;
}

/**
 * 实际分发计划（来自 CLI 描述器）：只含影响落盘结果的字段。
 * 不含 tool 显示名、operationId、时间戳——Codex 与 Claude 的等价计划必须得到相同指纹。
 */
export interface SkillsDistributionPlan {
  outputKeys: string[];
  entries: SkillsPlanEntry[];
  behavior: Record<string, unknown>;
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, `分发计划字段无效：${field}`);
  }
  return value;
}

/**
 * 有效输出指纹：对规范化计划（输出集合去重排序、条目按 relativePath 排序）做 HMAC。
 * 描述预期分发效果，不读取目标文件内容（design §2.3）。
 */
export function computeEffectiveOutputFingerprint(keyBytes: Buffer, plan: SkillsDistributionPlan): string {
  if (typeof plan !== 'object' || plan === null) {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, '分发计划必须是对象');
  }
  const outputKeys = [...new Set(plan.outputKeys.map((key) => requireNonEmpty(key, 'outputKeys[]')))].sort();
  const entries = plan.entries
    .map((entry) => ({
      relativePath: requireNonEmpty(entry.relativePath, 'entries[].relativePath'),
      targetPath: requireNonEmpty(entry.targetPath, 'entries[].targetPath'),
      sourcePath: requireNonEmpty(entry.sourcePath, 'entries[].sourcePath'),
      sourceVersion: requireNonEmpty(entry.sourceVersion, 'entries[].sourceVersion'),
      strategy: entry.strategy,
    }))
    .filter((entry, index, all) => all.findIndex((other) => other.relativePath === entry.relativePath) === index)
    .sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));
  for (const entry of entries) {
    if (entry.strategy !== 'symlink' && entry.strategy !== 'copy') {
      throw new WorkspaceError(ErrorCodes.InvalidArgument, `分发策略无效：${String(entry.strategy)}`);
    }
  }
  return hmacSha256(keyBytes, {
    fingerprintVersion: FINGERPRINT_VERSION,
    kind: 'effective_output',
    payload: { outputKeys, entries, behavior: plan.behavior ?? {} },
  });
}

export function keyStatusOf(result: KeyCheckResult): KeyStatus {
  return result.status === 'ok' ? 'ok' : result.status;
}
