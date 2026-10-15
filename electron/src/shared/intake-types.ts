// electron/src/shared/intake-types.ts
// Desktop 与共享引擎（.ai-workspace/scripts/lib/intake）之间的类型化契约。
// 字段与 CLI 的 `intake/v1` JSON 输出一一对应；两端共用同一份定义，
// 避免 Desktop 与 CLI 出现不同的规则（spec 硬约束）。

export type AssetType = 'rule' | 'skill' | 'mcp';
export type ActionKind = 'add' | 'link' | 'update' | 'variant' | 'ignore' | 'defer';
export type CandidateLabel =
  | 'new' | 'duplicate' | 'conflict' | 'changed' | 'managed' | 'similar' | 'unparseable';
export type ReadStatus = 'ok' | 'missing' | 'unreadable' | 'parse_error' | 'unsupported';
export type IntakeScope = 'project' | 'global';

export const ACTION_KINDS: readonly ActionKind[] = ['add', 'link', 'update', 'variant', 'ignore', 'defer'];
export const ACTION_LABELS: Record<ActionKind, string> = {
  add: '新增',
  link: '关联已有项',
  update: '更新原项',
  variant: '另存变体',
  ignore: '忽略',
  defer: '暂缓',
};
export const LABEL_LABELS: Record<CandidateLabel, string> = {
  new: '新增',
  duplicate: '完全重复',
  conflict: '同名冲突',
  changed: '来源变化',
  managed: '已纳管',
  similar: '疑似相似',
  unparseable: '无法解析',
};

/** 需要人工明确选择动作才能入库的风险标签（不可被批量「全选新增」绕过） */
export const RISKY_LABELS: readonly CandidateLabel[] = ['conflict', 'unparseable'];

/** 必须指定目标资产的动作（link/update/variant 没有目标就无法执行） */
export const TARGET_ACTION_KINDS: readonly ActionKind[] = ['link', 'update', 'variant'];
export const needsTarget = (kind: ActionKind | undefined): boolean =>
  kind !== undefined && TARGET_ACTION_KINDS.includes(kind);

export interface IntakeSourceSelection {
  path: string;
  tool: string; // 'auto' 或具体工具名
  scope: IntakeScope;
}

export interface SourceOccurrence {
  occurrence_id: string;
  asset_type: AssetType;
  source_root: string;
  tool: string;
  scope: string;
  path: string;
  original_name: string | null;
  content_fingerprint: string;
  read_status: ReadStatus;
  read_error: string | null;
  is_generated_copy: boolean;
  is_managed_link?: boolean;
  link_target: string | null;
  suspects: Array<{ line: number; reason: string }>;
}

export interface ScanBatch {
  schema: string;
  batch_id: string;
  repo: string;
  started_at: string;
  finished_at: string;
  sources: Array<{ source_root: string; tool: string; scope: string; status: string }>;
  occurrences: SourceOccurrence[];
  errors: Array<{ level: string; source: string | null; path: string | null; message: string }>;
  cancelled: boolean;
}

export interface DiffSummary { added: string[]; removed: string[]; changed: string[] }

export interface CandidateSourceRef {
  occurrence_id: string;
  name: string;
  read_status: ReadStatus;
  managed: boolean;
  source: { source_root: string; tool: string; scope: string; path: string };
}

export interface Candidate {
  candidate_id: string;
  type: AssetType;
  names: string[];
  display_name: string;
  content_fingerprint: string | null;
  cred_fingerprint: string | null;
  cred_refs: Array<{ field: string; ref: string }>;
  labels: CandidateLabel[];
  occurrences: string[];
  sources: CandidateSourceRef[];
  existing_asset_id: string | null;
  existing_version: number | null;
  existing_source: { name: string; path: string; fingerprint: string } | null;
  diff_summary: DiffSummary;
  behavior_diff: DiffSummary | null;
  credential_diff: DiffSummary | null;
  deferred: boolean;
  suppressed: boolean;
}

/** 总库既有规范源（供 UI 选择关联/更新/变体的实际目标） */
export interface RepoAssetRef {
  asset_id: string;
  type: AssetType;
  name: string;
  path: string;
  /** 已登记时的当前版本；未登记为 null */
  version: number | null;
  /** false = 总库既有但尚未纳入 registry（首次纳管） */
  registered: boolean;
}

export interface CandidateSet {
  schema: string;
  batch_id: string;
  repo: string;
  compared_at: string;
  repo_assets: Record<string, number>;
  repo_asset_list: RepoAssetRef[];
  candidates: Candidate[];
  suppressed: Array<{ candidate_id: string; type: AssetType; names: string[]; occurrences: string[]; reason: string }>;
  summary: Record<string, number>;
  errors: unknown[];
}

export interface PlanAction {
  action_id: string;
  kind: ActionKind;
  candidate_id: string;
  asset_type: AssetType;
  asset_name: string;
  target_asset_id: string | null;
  source_fingerprint: string | null;
  target_version_snapshot: number | null;
  /** 目标规范源路径（计划时快照），便于预览里说明"会写到哪" */
  target_path?: string | null;
  /** 实际写入路径，新增和变体也由共享引擎计算。 */
  write_path?: string | null;
  resolved: boolean;
}

export interface ReviewPlan {
  schema: string;
  plan_id: string;
  batch_id: string;
  repo: string;
  created_at: string;
  expires_at: string;
  actions: PlanAction[];
  unresolved: string[];
  skipped: string[];
  summary: Record<string, number>;
}

export interface ApplyStage { stage: string; status: string; detail: string }

export interface ApplyBatch {
  schema: string;
  apply_id: string;
  plan_id: string;
  batch_id: string;
  status: string;
  stages: ApplyStage[];
  applied_actions: string[];
  failed_actions: Array<{ action_id?: string | null; kind?: string | null; reason?: string; error?: string }>;
  files: Array<{
    rel: string;
    op: string;
    before_fingerprint: string | null;
    after_fingerprint: string;
    backup_rel: string | null;
  }>;
  created_assets: string[];
  created_versions: Array<{ asset_id: string; version: number; kind?: string }>;
  errors: string[];
  rollback?: { status: string; at: string; restored: string[]; conflicts: Array<{ rel: string; reason: string }> } | null;
}

export interface IntakeApplyHistoryEntry {
  apply_id: string;
  plan_id: string;
  batch_id: string;
  status: string;
  started_at: string;
  finished_at: string;
  applied_actions: number;
  failed_actions: number;
  rollback: { status: string } | null;
}

export interface IntakeStatusResult {
  schema: string;
  plans: ReviewPlan[];
  apply_history: IntakeApplyHistoryEntry[];
}

export interface IntakeProgressEvent {
  repoPath: string;
  operation: 'scan' | 'apply';
  message: string;
  pct: number | null;
}

export interface IntakeScanArgs {
  repoPath: string;
  sources: IntakeSourceSelection[];
  manualFiles?: string[];
  manualSkills?: string[];
}

/** 一条人工决定；需要目标的动作必须带上实际选定的 asset_id */
export interface PlanDecision {
  candidate_id: string;
  kind: ActionKind;
  target_asset_id?: string | null;
}

export interface IntakePlanArgs {
  repoPath: string;
  batchId: string;
  decisions: PlanDecision[];
}

export interface IntakeStatusArgs {
  repoPath: string;
  planId?: string;
  batchId?: string;
}

export interface IntakeApplyArgs {
  repoPath: string;
  planId: string;
  resume?: boolean;
}

export interface IntakeBatchPayload {
  scan: ScanBatch;
  candidates: CandidateSet | null;
}
