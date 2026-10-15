import { ACTION_KINDS, ACTION_LABELS, type ActionKind, type DiffSummary } from '../../shared/intake-types';

export function DiffBlock({ title, diff }: { title: string; diff: DiffSummary | null }) {
  if (!diff) return null;
  const empty = !diff.added.length && !diff.removed.length && !diff.changed.length;
  if (empty) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div className="muted">{title}</div>
      <div className="diff">
        {diff.added.map((l) => <span className="added" key={`a${l}`}>+ {l}</span>)}
        {diff.removed.map((l) => <span className="removed" key={`r${l}`}>- {l}</span>)}
        {diff.changed.map((l) => <span key={`c${l}`}>~ {l}</span>)}
      </div>
    </div>
  );
}


export function ActionButtons({ value, onPick }: { value?: ActionKind; onPick: (k: ActionKind) => void }) {
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
      {ACTION_KINDS.map((k) => (
        <button
          key={k}
          type="button"
          className={value === k ? 'tab active' : 'tab'}
          aria-pressed={value === k}
          onClick={() => onPick(k)}
        >
          {ACTION_LABELS[k]}
        </button>
      ))}
    </div>
  );
}



export const EXECUTION_STATUS_LABELS: Record<string, string> = {
  ok: '成功', already_applied: '已执行，无需重复', failed: '失败',
  skipped: '已跳过', pending: '待执行', running: '执行中',
  stale: '计划已失效', expired: '计划已过期', rolled_back: '已回退',
};

export const EXECUTION_STAGE_LABELS: Record<string, string> = {
  preflight: '检查执行条件', write_assets: '写入配置资产',
  write_registry: '登记资产版本', write_history: '保存执行记录',
};

export const FILE_OPERATION_LABELS: Record<string, string> = {
  replace_dir: '更新目录', write_file: '写入文件', delete_file: '删除文件',
};
