// electron/src/main/intake-args.ts
// IPC 收编通道入参校验（系统边界快速失败）。
// 与 rules-args.ts 同样独立成文件：ipc.ts 顶层有 app.getPath 副作用，
// 单独放这里让 main 进程之外的测试可以直接覆盖。

import { WorkspaceError, ErrorCodes } from '../core/errors';
import { SUPPORTED_TOOLS } from '../shared/tools';
import {
  ACTION_KINDS,
  TARGET_ACTION_KINDS,
  type ActionKind,
  type IntakeSourceSelection,
  type PlanDecision,
} from '../shared/intake-types';

function requireRepoPath(a: Record<string, unknown>, channel: string): string {
  if (typeof a.repoPath !== 'string' || !a.repoPath) {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, `${channel}: repoPath 必填且为非空字符串`);
  }
  return a.repoPath;
}

function asObject(args: unknown, channel: string): Record<string, unknown> {
  if (!args || typeof args !== 'object') {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, `${channel}: args 必须是对象`);
  }
  return args as Record<string, unknown>;
}

function requireString(a: Record<string, unknown>, key: string, channel: string): string {
  const v = a[key];
  if (typeof v !== 'string' || !v) {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, `${channel}: ${key} 必填且为非空字符串`);
  }
  return v;
}

function optionalStringArray(a: Record<string, unknown>, key: string, channel: string): string[] {
  const v = a[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x)) {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, `${channel}: ${key} 必须是字符串数组`);
  }
  return v as string[];
}

export interface IntakeScanIpcArgs {
  repoPath: string;
  sources: IntakeSourceSelection[];
  manualFiles: string[];
  manualSkills: string[];
}

export function validateIntakeScanArgs(raw: unknown): IntakeScanIpcArgs {
  const a = asObject(raw, 'IntakeScan');
  const repoPath = requireRepoPath(a, 'IntakeScan');
  const manualFiles = optionalStringArray(a, 'manualFiles', 'IntakeScan');
  const manualSkills = optionalStringArray(a, 'manualSkills', 'IntakeScan');

  const rawSources = a.sources;
  if (rawSources !== undefined && rawSources !== null && !Array.isArray(rawSources)) {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, 'IntakeScan: sources 必须是数组');
  }
  const sources: IntakeSourceSelection[] = [];
  for (const item of (rawSources ?? []) as unknown[]) {
    if (!item || typeof item !== 'object') {
      throw new WorkspaceError(ErrorCodes.InvalidArgument, 'IntakeScan: sources 每项必须是对象');
    }
    const s = item as Record<string, unknown>;
    if (typeof s.path !== 'string' || !s.path) {
      throw new WorkspaceError(ErrorCodes.InvalidArgument, 'IntakeScan: source.path 必填且为非空字符串');
    }
    const tool = s.tool === undefined || s.tool === null ? 'auto' : s.tool;
    if (typeof tool !== 'string' || (tool !== 'auto' && !SUPPORTED_TOOLS.includes(tool as never))) {
      throw new WorkspaceError(
        ErrorCodes.UnsupportedTool,
        `IntakeScan: source.tool 必须是 auto 或 ${SUPPORTED_TOOLS.join('/')}，收到 ${JSON.stringify(s.tool)}`
      );
    }
    const scope = s.scope === undefined || s.scope === null ? 'project' : s.scope;
    if (scope !== 'project' && scope !== 'global') {
      throw new WorkspaceError(ErrorCodes.InvalidArgument, `IntakeScan: source.scope 必须是 project/global，收到 ${JSON.stringify(s.scope)}`);
    }
    sources.push({ path: s.path, tool, scope });
  }

  if (sources.length === 0 && manualFiles.length === 0 && manualSkills.length === 0) {
    throw new WorkspaceError(
      ErrorCodes.InvalidArgument,
      'IntakeScan: 至少需要一个来源（sources / manualFiles / manualSkills）'
    );
  }
  return { repoPath, sources, manualFiles, manualSkills };
}

export function validateIntakeRepoArgs(raw: unknown, channel: string): string {
  return requireRepoPath(asObject(raw, channel), channel);
}

export function validateIntakeBatchArgs(raw: unknown, channel: string): { repoPath: string; batchId: string } {
  const a = asObject(raw, channel);
  return { repoPath: requireRepoPath(a, channel), batchId: requireString(a, 'batchId', channel) };
}

export function validateIntakePlanArgs(raw: unknown): { repoPath: string; batchId: string; decisions: PlanDecision[] } {
  const a = asObject(raw, 'IntakePlan');
  const repoPath = requireRepoPath(a, 'IntakePlan');
  const batchId = requireString(a, 'batchId', 'IntakePlan');

  if (!Array.isArray(a.decisions)) {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, 'IntakePlan: decisions 必须是数组');
  }
  const decisions: PlanDecision[] = [];
  for (const item of a.decisions as unknown[]) {
    if (!item || typeof item !== 'object') {
      throw new WorkspaceError(ErrorCodes.InvalidArgument, 'IntakePlan: decisions 每项必须是对象');
    }
    const d = item as Record<string, unknown>;
    if (typeof d.candidate_id !== 'string' || !d.candidate_id) {
      throw new WorkspaceError(ErrorCodes.InvalidArgument, 'IntakePlan: decision.candidate_id 必填且为非空字符串');
    }
    if (typeof d.kind !== 'string' || !ACTION_KINDS.includes(d.kind as ActionKind)) {
      throw new WorkspaceError(
        ErrorCodes.InvalidArgument,
        `IntakePlan: decision.kind 必须是 ${ACTION_KINDS.join('/')}，收到 ${JSON.stringify(d.kind)}`
      );
    }
    const kind = d.kind as ActionKind;
    const rawTarget = d.target_asset_id;
    if (rawTarget !== undefined && rawTarget !== null) {
      if (typeof rawTarget !== 'string' || !rawTarget) {
        throw new WorkspaceError(ErrorCodes.InvalidArgument, 'IntakePlan: decision.target_asset_id 必须是非空字符串');
      }
      if (!TARGET_ACTION_KINDS.includes(kind)) {
        throw new WorkspaceError(
          ErrorCodes.InvalidArgument,
          `IntakePlan: ${kind} 不接受 target_asset_id（只有 ${TARGET_ACTION_KINDS.join('/')} 需要目标）`
        );
      }
      decisions.push({ candidate_id: d.candidate_id, kind, target_asset_id: rawTarget });
      continue;
    }
    decisions.push({ candidate_id: d.candidate_id, kind });
  }
  return { repoPath, batchId, decisions };
}

export function validateIntakeApplyArgs(raw: unknown): { repoPath: string; planId: string; resume: boolean } {
  const a = asObject(raw, 'IntakeApply');
  const repoPath = requireRepoPath(a, 'IntakeApply');
  const planId = requireString(a, 'planId', 'IntakeApply');
  if (a.resume !== undefined && typeof a.resume !== 'boolean') {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, 'IntakeApply: resume 必须是 boolean');
  }
  return { repoPath, planId, resume: a.resume === true };
}

export function validateIntakeRollbackArgs(raw: unknown): { repoPath: string; applyId: string } {
  const a = asObject(raw, 'IntakeRollback');
  return { repoPath: requireRepoPath(a, 'IntakeRollback'), applyId: requireString(a, 'applyId', 'IntakeRollback') };
}

/**
 * 状态查询：planId / batchId 是可选过滤条件。
 * 只给 repoPath 表示「查询该总库的全部执行历史与计划」——这是入库记录与回退入口依赖的用法。
 */
export function validateIntakeStatusArgs(raw: unknown): { repoPath: string; planId?: string; batchId?: string } {
  const a = asObject(raw, 'IntakeStatus');
  const repoPath = requireRepoPath(a, 'IntakeStatus');
  const planId = typeof a.planId === 'string' && a.planId ? a.planId : undefined;
  const batchId = typeof a.batchId === 'string' && a.batchId ? a.batchId : undefined;
  if (a.planId !== undefined && a.planId !== null && planId === undefined) {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, 'IntakeStatus: planId 必须是非空字符串');
  }
  if (a.batchId !== undefined && a.batchId !== null && batchId === undefined) {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, 'IntakeStatus: batchId 必须是非空字符串');
  }
  return { repoPath, planId, batchId };
}
