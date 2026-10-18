// electron/src/shared/sync-status-view.ts
// 功能 002 TASK-002-06：状态查询的渲染层视图契约（design §6）。
// 只暴露界面需要的状态、原因码与时间；不含指纹、keyId、路径、哈希或状态文件结构。
import type { AttemptState, SyncModule, SyncScope, SyncTool, VersionState } from './sync-status';

export interface SyncStatusUnitView {
  tool: SyncTool;
  module: SyncModule;
  scope: SyncScope;
  versionState: VersionState;
  attemptState: AttemptState;
  /** 不含敏感内容的稳定原因码；UI 映射为文案。 */
  reasonCode?: string;
  /** 可信成功基线的 UTC 完成时间；无基线时缺省。 */
  lastSuccessAt?: string;
  /** 最近一次尝试的 UTC 结束时间（running 用开始时间）。 */
  lastAttemptAt?: string;
}

/** 聚合（design §2.2）：running > unknown > pending/untracked > current；适用单元为 0 时 empty。 */
export type SyncAggregateState = 'running' | 'partial_unknown' | 'pending' | 'current' | 'untracked' | 'empty';

export interface SyncStatusAggregate {
  state: SyncAggregateState;
  /** 待同步（pending）与未记录（untracked）适用单元总数。 */
  pendingCount: number;
  /** 不含 disabled/unsupported 的适用单元数。 */
  applicableCount: number;
  /** 固定文案；current 为「已同步当前版本（未检查目标文件）」。 */
  summaryText: string;
}

export interface SyncStatusQueryResult {
  /** 查询完成时刻（UTC ISO 8601）；界面显示「最近检查」。 */
  checkedAt: string;
  aggregate: SyncStatusAggregate;
  units: SyncStatusUnitView[];
  /** 本机状态文件损坏/密钥无效等：界面提示重建，不伪装成空记录。 */
  storeProblem?: {
    reasonCode: 'status_invalid' | 'status_unreadable';
    message: string;
    rebuildAvailable: boolean;
  };
}

export interface SyncStatusQueryRequest {
  /** 应用项目 id；缺省或 'content-library' 表示无项目（project 单元不得显示为 current）。 */
  repoId?: string;
  scope: SyncScope;
  tool?: SyncTool;
  module?: SyncModule;
}

export const SYNC_AGGREGATE_TEXT: Record<SyncAggregateState, string> = {
  running: '同步中',
  partial_unknown: '部分状态未知',
  pending: '待同步',
  current: '已同步当前版本（未检查目标文件）',
  untracked: '未记录',
  empty: '无可同步单元',
};

export const VERSION_STATE_TEXT: Record<VersionState, string> = {
  untracked: '未记录',
  pending: '待同步',
  current: '已同步当前版本（未检查目标文件）',
  disabled: '模块已禁用',
  unsupported: '当前工具不支持',
  unknown: '状态未知',
};

export const ATTEMPT_STATE_TEXT: Record<AttemptState, string> = {
  never: '尚未执行',
  running: '同步中',
  succeeded: '最近一次成功',
  failed: '最近一次失败',
  cancelled: '最近一次取消',
  interrupted: '上次中断',
  source_changed: '来源已变化',
  skipped: '最近一次跳过',
  record_failed: '结果未能写入',
};

/** reasonCode → 界面短文案；未收录的码原样交给上层或省略。 */
export const REASON_TEXT: Record<string, string> = {
  module_disabled: '模块已关闭',
  tool_unsupported: '工具不支持该模块',
  no_entries: '无可分发内容',
  mapping_missing: '缺少规则映射',
  dependency_missing: '缺少运行依赖',
  secret_unresolved: '凭据未解决',
  invalid_config: '配置无效',
  partial_failure: '部分失败',
  needs_resync: '需要重新同步',
  source_changed: '来源已变化',
  key_missing: '指纹密钥缺失',
  key_invalid: '指纹密钥无效',
  key_changed: '指纹密钥已更换',
  source_unreadable: '来源不可读取',
  target_missing: '目标路径不存在',
  library_missing: '内容库不可用',
  describe_failed: '无法读取输入描述',
  inputs_unreadable: '输入不可读取',
  skill_link: '单项链接完成（模块仍需同步）',
  skill_unlink: '单项卸载（模块仍需同步）',
  single_write_failed: '单项写入失败',
  cancelled: '已取消',
};

export function reasonText(reasonCode?: string): string | undefined {
  if (!reasonCode) return undefined;
  return REASON_TEXT[reasonCode] ?? reasonCode;
}
