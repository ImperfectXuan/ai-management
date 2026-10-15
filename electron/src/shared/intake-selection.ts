// electron/src/shared/intake-selection.ts
// 渲染进程与主进程共用的纯函数（不依赖 node 内置模块，可直接打进 renderer bundle）。
// 这里的规则与 CLI 的 plan 校验一致：冲突 / 无法解析项必须逐项明确选择动作，
// 批量「全选新增」不能把它们一并批准（spec §5.3）；
// 需要目标的动作必须给出实际存在的同类型目标（引擎侧还会再校验一次）。

import type { ActionKind, Candidate, RepoAssetRef } from './intake-types';
import { TARGET_ACTION_KINDS } from './intake-types';

export function riskyCandidates(candidates: Candidate[]): Candidate[] {
  return candidates.filter((c) => c.labels.includes('conflict') || c.labels.includes('unparseable'));
}

/**
 * 批量「全选新增」：只作用于非风险候选。
 * @returns next 新的动作表；skipped 被跳过的风险候选（需逐项选择）
 */
export function selectAllAsNew(
  candidates: Candidate[],
  current: Record<string, ActionKind>
): { next: Record<string, ActionKind>; skipped: Candidate[] } {
  const next = { ...current };
  const skipped: Candidate[] = [];
  for (const c of candidates) {
    if (c.labels.includes('conflict') || c.labels.includes('unparseable')) {
      skipped.push(c);
      continue;
    }
    if (!current[c.candidate_id]) next[c.candidate_id] = 'add';
  }
  return { next, skipped };
}

export const actionNeedsTarget = (kind: ActionKind | undefined): boolean =>
  kind !== undefined && TARGET_ACTION_KINDS.includes(kind);

/**
 * 某个候选可选的目标：只取同类型的总库既有资产（含未登记但总库确实存在的规范源）。
 * 候选自动匹配到的既有项排在最前，便于默认选择。
 */
export function targetOptionsFor(candidate: Candidate, repoAssets: RepoAssetRef[]): RepoAssetRef[] {
  const sameType = repoAssets.filter((a) => a.type === candidate.type && a.asset_id);
  const auto = candidate.existing_asset_id;
  return [...sameType].sort((a, b) => {
    if (a.asset_id === auto) return -1;
    if (b.asset_id === auto) return 1;
    return (a.name || a.path).localeCompare(b.name || b.path);
  });
}

/** 该候选的默认目标（自动匹配结果）；没有则为空 */
export function defaultTargetFor(candidate: Candidate): string | null {
  return candidate.existing_asset_id ?? null;
}
