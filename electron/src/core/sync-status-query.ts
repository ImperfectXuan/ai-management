// electron/src/core/sync-status-query.ts
// 功能 002 TASK-002-06：只读状态查询（design §6）。
// 主进程解析 library/project/global 真实路径，按当前配置枚举单元并重算版本状态；
// 不创建密钥、不解密 vault、不联网、不写状态文件与目标。渲染层只拿视图模型。
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { ErrorCodes, WorkspaceError } from './errors';
import { SyncStatusStore } from './sync-status-store';
import { checkKeyFile, KeyCheckResult } from './sync-fingerprint';
import {
  SyncInputsDescriptor,
  computeUnitFingerprints,
  describeSyncInputs,
  loadDescriptorInputs,
} from './sync-inputs';
import { resolveUnitKey } from './sync-unit-identity';
import { loadConfig } from './config';
import {
  AttemptState,
  KeyStatus,
  KeyProblemCode,
  SyncModule,
  SyncRecord,
  SyncScope,
  SyncTool,
  isTrustedSuccess,
  keyProblemFor,
  resolveVersionState,
  unitKeyString,
} from '../shared/sync-status';
import {
  SYNC_AGGREGATE_TEXT,
  SyncAggregateState,
  SyncStatusAggregate,
  SyncStatusQueryRequest,
  SyncStatusQueryResult,
  SyncStatusUnitView,
} from '../shared/sync-status-view';

const ALL_MODULES: SyncModule[] = ['rules', 'mcp', 'skills'];

export interface SyncStatusQueryOptions {
  store: SyncStatusStore;
  /** 本机指纹密钥路径；查询只读检查，绝不创建。 */
  keyFile: string;
  libraryRoot: string;
  /** project 单元的目标；无项目时缺省，project 单元不进入列表。 */
  projectRoot?: string;
  /** 缺省为 <libraryRoot>/.ai-workspace/scripts/aiws */
  cliPath?: string;
  signal?: AbortSignal;
}

function applicabilityFromDescriptor(descriptor: SyncInputsDescriptor): 'applicable' | 'disabled' | 'unsupported' {
  if (descriptor.executable) return 'applicable';
  if (descriptor.reasonCode === 'module_disabled') return 'disabled';
  if (descriptor.reasonCode === 'tool_unsupported') return 'unsupported';
  return 'applicable';
}

function toKeyStatus(check: KeyCheckResult): KeyStatus {
  return check.status === 'ok' ? 'ok' : check.status;
}

function currentKeyIdOf(check: KeyCheckResult): string | null {
  return check.status === 'ok' ? check.keyId : null;
}

function attemptStateOf(record: SyncRecord | undefined): AttemptState {
  return record?.lastAttempt?.state ?? 'never';
}

function lastAttemptAtOf(record: SyncRecord | undefined): string | undefined {
  if (!record?.lastAttempt) return undefined;
  return record.lastAttempt.endedAt ?? record.lastAttempt.startedAt;
}

/** 查询期密钥身份问题；与 store 侧一致：无基线时不把 key_missing/invalid 报成故障。 */
function keyProblemForQuery(
  successKeyId: string | undefined,
  check: KeyCheckResult,
): KeyProblemCode | null {
  if (successKeyId === undefined) return null;
  return keyProblemFor(successKeyId, currentKeyIdOf(check), toKeyStatus(check));
}

async function resolveCurrentFingerprint(args: {
  descriptor: SyncInputsDescriptor;
  libraryRoot: string;
  keyBytes: Buffer;
  cliPath?: string;
}): Promise<string | null> {
  if (!args.descriptor.executable) return null;
  try {
    const loaded = await loadDescriptorInputs(args.descriptor, {
      libraryRoot: args.libraryRoot,
      scriptsDir: path.join(args.libraryRoot, '.ai-workspace/scripts'),
    });
    return computeUnitFingerprints(args.keyBytes, args.descriptor, loaded).sourceFingerprint;
  } catch {
    return null;
  }
}

/**
 * 枚举查询单元：tools × modules（global 自动剔除 rules）。
 * 无项目时 project 单元不进入列表（design §6：不能显示 project current）。
 */
function enumerateUnits(args: {
  tools: SyncTool[];
  modules: SyncModule[];
  scope: SyncScope;
  hasProject: boolean;
  tool?: SyncTool;
  module?: SyncModule;
}): Array<{ tool: SyncTool; module: SyncModule }> {
  const tools = args.tool ? args.tools.filter((tool) => tool === args.tool) : args.tools;
  let modules = args.module ? args.modules.filter((module) => module === args.module) : args.modules;
  if (args.scope === 'global') modules = modules.filter((module) => module !== 'rules');
  const units: Array<{ tool: SyncTool; module: SyncModule }> = [];
  for (const tool of tools) {
    for (const module of modules) {
      if (args.scope === 'project' && !args.hasProject) continue;
      units.push({ tool, module });
    }
  }
  return units;
}

function aggregateOf(units: SyncStatusUnitView[]): SyncStatusAggregate {
  const applicable = units.filter((unit) => unit.versionState !== 'disabled' && unit.versionState !== 'unsupported');
  const pendingCount = applicable.filter(
    (unit) => unit.versionState === 'pending' || unit.versionState === 'untracked',
  ).length;
  const hasRunning = applicable.some((unit) => unit.attemptState === 'running');
  const hasUnknown = applicable.some((unit) => unit.versionState === 'unknown');
  const allUntracked = applicable.length > 0 && applicable.every((unit) => unit.versionState === 'untracked');
  const allCurrent = applicable.length > 0 && applicable.every((unit) => unit.versionState === 'current');

  let state: SyncAggregateState;
  if (hasRunning) state = 'running';
  else if (hasUnknown) state = 'partial_unknown';
  else if (allUntracked) state = 'untracked';
  else if (pendingCount > 0) state = 'pending';
  else if (allCurrent) state = 'current';
  else state = 'empty';

  const summaryText = state === 'pending' || state === 'untracked'
    ? `待同步（${pendingCount} 项）`
    : SYNC_AGGREGATE_TEXT[state];
  return { state, pendingCount, applicableCount: applicable.length, summaryText };
}

function unitFallback(input: {
  tool: SyncTool;
  module: SyncModule;
  scope: SyncScope;
  versionState: SyncStatusUnitView['versionState'];
  attemptState: AttemptState;
  reasonCode?: string;
  lastSuccessAt?: string;
  lastAttemptAt?: string;
}): SyncStatusUnitView {
  return input;
}

/**
 * 只读查询一个分发选择下的全部单元状态。
 * 密钥检查先于指纹；无基线时不报密钥故障。状态文件损坏返回 storeProblem，不伪装成空记录。
 */
export async function querySyncStatus(
  request: SyncStatusQueryRequest,
  options: SyncStatusQueryOptions,
): Promise<SyncStatusQueryResult> {
  const checkedAt = new Date().toISOString();
  const scope = request.scope;

  let loadError: WorkspaceError | null = null;
  try {
    await options.store.load();
  } catch (error) {
    if (error instanceof WorkspaceError && error.code === ErrorCodes.SyncStatusInvalid) {
      loadError = error;
    } else {
      throw error;
    }
  }
  if (loadError) {
    return {
      checkedAt,
      aggregate: {
        state: 'partial_unknown',
        pendingCount: 0,
        applicableCount: 0,
        summaryText: '本机同步记录不可用',
      },
      units: [],
      storeProblem: {
        reasonCode: 'status_invalid',
        message: loadError.message,
        rebuildAvailable: true,
      },
    };
  }

  let configTools: string[];
  try {
    configTools = (await loadConfig(path.join(options.libraryRoot, '.ai-workspace'))).tools;
  } catch {
    configTools = [];
  }
  const tools = configTools.filter((tool): tool is SyncTool =>
    ['codex', 'claude', 'cursor', 'trae'].includes(tool));

  const keyCheck = await checkKeyFile(options.keyFile);

  const unitsEnumerated = enumerateUnits({
    tools,
    modules: ALL_MODULES,
    scope,
    hasProject: Boolean(options.projectRoot),
    tool: request.tool,
    module: request.module,
  });

  const records = await options.store.list({
    libraryRoot: options.libraryRoot,
    scope,
    ...(request.tool ? { tool: request.tool } : {}),
    ...(request.module ? { module: request.module } : {}),
  });
  const recordMap = new Map(records.map((record) => [unitKeyString(record.key), record]));
  const units: SyncStatusUnitView[] = [];

  for (const unit of unitsEnumerated) {
    const identity = await resolveUnitKey({
      libraryPath: options.libraryRoot,
      projectPath: options.projectRoot,
      tool: unit.tool,
      module: unit.module,
      scope,
    });

    if (!identity.ok) {
      units.push(unitFallback({
        tool: unit.tool,
        module: unit.module,
        scope,
        versionState: 'unknown',
        attemptState: 'never',
        reasonCode: identity.reason,
      }));
      continue;
    }

    const key = identity.key;
    const record = recordMap.get(unitKeyString(key));
    const success = isTrustedSuccess(record?.lastSuccess) ? record?.lastSuccess : undefined;

    let descriptor: SyncInputsDescriptor | null = null;
    let describeFailed = false;
    try {
      descriptor = await describeSyncInputs({
        libraryRoot: options.libraryRoot,
        targetRoot: key.targetRoot,
        tool: unit.tool,
        module: unit.module,
        scope,
        cliPath: options.cliPath,
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal?.aborted || (error instanceof WorkspaceError && error.code === ErrorCodes.SyncCancelled)) {
        throw error;
      }
      describeFailed = true;
    }

    // 无基线且 describe 失败：仍为 untracked（不能因无法枚举输入就伪装密钥/来源故障）
    if (!success && (describeFailed || !descriptor)) {
      units.push(unitFallback({
        tool: unit.tool,
        module: unit.module,
        scope,
        versionState: 'untracked',
        attemptState: attemptStateOf(record),
        reasonCode: record?.lastAttempt?.reasonCode,
        lastAttemptAt: lastAttemptAtOf(record),
      }));
      continue;
    }

    if (describeFailed || !descriptor) {
      const keyProblem = keyProblemForQuery(success?.keyId, keyCheck);
      const resolved = resolveVersionState({
        applicability: 'applicable',
        record: record ?? null,
        keyProblem,
        currentSourceFingerprint: null,
        reasonCode: 'describe_failed',
      });
      units.push(unitFallback({
        tool: unit.tool,
        module: unit.module,
        scope,
        versionState: resolved.state,
        attemptState: attemptStateOf(record),
        reasonCode: resolved.reasonCode ?? 'describe_failed',
        lastSuccessAt: success?.completedAt,
        lastAttemptAt: lastAttemptAtOf(record),
      }));
      continue;
    }

    const applicability = applicabilityFromDescriptor(descriptor);
    // 不可执行单元：不读输入、不算指纹；密钥问题仍优先于 disabled 之后的 unknown 路径
    if (applicability !== 'applicable') {
      const resolved = resolveVersionState({
        applicability,
        record: record ?? null,
        currentSourceFingerprint: null,
      });
      units.push(unitFallback({
        tool: unit.tool,
        module: unit.module,
        scope,
        versionState: resolved.state,
        attemptState: attemptStateOf(record),
        reasonCode: resolved.reasonCode,
        lastSuccessAt: success?.completedAt,
        lastAttemptAt: lastAttemptAtOf(record),
      }));
      continue;
    }

    const keyProblem = keyProblemForQuery(success?.keyId, keyCheck);
    let currentFingerprint: string | null = null;
    if (keyCheck.status === 'ok') {
      currentFingerprint = await resolveCurrentFingerprint({
        descriptor,
        libraryRoot: options.libraryRoot,
        keyBytes: keyCheck.keyBytes,
        cliPath: options.cliPath,
      });
    }

    const resolved = resolveVersionState({
      applicability,
      record: record ?? null,
      keyProblem,
      currentSourceFingerprint: currentFingerprint,
    });

    units.push(unitFallback({
      tool: unit.tool,
      module: unit.module,
      scope,
      versionState: resolved.state,
      attemptState: attemptStateOf(record),
      reasonCode: resolved.reasonCode,
      lastSuccessAt: success?.completedAt,
      lastAttemptAt: lastAttemptAtOf(record),
    }));
  }

  return {
    checkedAt,
    aggregate: aggregateOf(units),
    units,
  };
}

/**
 * 显式重建本机同步记录（design §6）：
 * 备份损坏/旧状态文件与指纹密钥后删除，仅重置本机元数据；不触碰内容库与工具文件。
 * 返回备份路径（有备份时）。
 */
export async function rebuildLocalSyncStatus(paths: {
  statusFile: string;
  keyFile: string;
}): Promise<{ statusBackup?: string; keyBackup?: string }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const result: { statusBackup?: string; keyBackup?: string } = {};

  for (const [field, file] of [
    ['statusBackup', paths.statusFile],
    ['keyBackup', paths.keyFile],
  ] as const) {
    try {
      await fsp.access(file);
    } catch {
      continue;
    }
    const backup = `${file}.bak-${stamp}`;
    await fsp.rename(file, backup);
    result[field] = backup;
  }
  return result;
}
