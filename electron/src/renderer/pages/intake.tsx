// electron/src/renderer/pages/intake.tsx
// 人工收编向导：总库/来源选择 → 扫描（可取消）→ 候选审核（六种动作）→ 计划预览 → 入库 → 记录与回退。
// 全部规则来自共享引擎（aiws intake），本页只做编排与展示；无模型配置也能走完整闭环。
import { useCallback, useEffect, useState } from 'react';
import { invoke, onProgress } from '../api';
import { IPC } from '../../shared/ipc';
import { SUPPORTED_TOOLS } from '../../shared/tools';
import {
  ACTION_LABELS,
  LABEL_LABELS,
  RISKY_LABELS,
  needsTarget,
  type ActionKind,
  type ApplyBatch,
  type Candidate,
  type CandidateLabel,
  type CandidateSet,
  type IntakeApplyHistoryEntry,
  type IntakeSourceSelection,
  type PlanDecision,
  type RepoAssetRef,
  type ReviewPlan,
  type ScanBatch,
} from '../../shared/intake-types';
import { ActionButtons, DiffBlock, EXECUTION_STATUS_LABELS, EXECUTION_STAGE_LABELS, FILE_OPERATION_LABELS } from './intake-view';
import { defaultTargetFor, selectAllAsNew, targetOptionsFor } from '../../shared/intake-selection';

const TOOL_OPTIONS = ['auto', ...SUPPORTED_TOOLS];
const RISK_SET = new Set<CandidateLabel>(RISKY_LABELS);
type IntakeStep = 'sources' | 'review' | 'plan' | 'result';


export function IntakePage({ repoPath: initialRepo, lockedLibrary = false }: { repoPath: string; lockedLibrary?: boolean }) {
  const [step, setStep] = useState<IntakeStep>('sources');
  const [repoPath, setRepoPath] = useState(initialRepo);
  const [sources, setSources] = useState<IntakeSourceSelection[]>([]);
  const [newSource, setNewSource] = useState<IntakeSourceSelection>({ path: '', tool: 'auto', scope: 'project' });
  const [manualFiles, setManualFiles] = useState('');
  const [manualSkills, setManualSkills] = useState('');
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [scan, setScan] = useState<ScanBatch | null>(null);
  const [candidates, setCandidates] = useState<CandidateSet | null>(null);
  const [decisions, setDecisions] = useState<Record<string, ActionKind>>({});
  // 需要目标的动作必须指定实际资产；不选就用候选自动匹配到的既有项
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [plan, setPlan] = useState<ReviewPlan | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyBatch | null>(null);
  const [history, setHistory] = useState<IntakeApplyHistoryEntry[]>([]);
  const [historyError, setHistoryError] = useState('');

  useEffect(() => { setRepoPath(initialRepo); }, [initialRepo]);

  useEffect(() => {
    const off = onProgress(IPC.IntakeProgress, (d) => {
      const ev = d as { repoPath: string; message: string; pct: number | null };
      if (ev.repoPath !== repoPath) return;
      setProgress(ev.pct === null ? ev.message : `${ev.message} (${ev.pct}%)`);
    });
    return off;
  }, [repoPath]);

  // 入库记录查询失败必须显式报错：把失败伪装成"没有记录"会让回退入口凭空消失
  const refreshHistory = useCallback(async (root: string) => {
    setHistoryError('');
    try {
      const st = await invoke<{ apply_history: IntakeApplyHistoryEntry[] }>(IPC.IntakeStatus, { repoPath: root });
      setHistory(st.apply_history ?? []);
    } catch (e) {
      setHistory([]);
      setHistoryError(`读取入库记录失败：${(e as Error).message}`);
    }
  }, []);

  useEffect(() => { if (repoPath) refreshHistory(repoPath); }, [repoPath, refreshHistory]);

  // 动作、目标或总库一变，既有计划就不再对应当前审核状态，必须重新生成
  useEffect(() => { setPlan(null); setApplyResult(null); }, [decisions, targets, repoPath]);

  useEffect(() => {
    setScan(null); setCandidates(null); setPlan(null); setApplyResult(null);
    setDecisions({}); setTargets({}); setSelected(null); setStep('sources');
  }, [repoPath, sources, manualFiles, manualSkills]);

  const addSource = () => {
    if (!newSource.path) return;
    setSources((prev) => [...prev, newSource]);
    setNewSource({ path: '', tool: 'auto', scope: 'project' });
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError(''); setNotice('');
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); setProgress(''); }
  };

  const startScan = () => run('扫描中', async () => {
    setScan(null); setCandidates(null); setPlan(null); setApplyResult(null);
    setDecisions({}); setTargets({});
    const batch = await invoke<ScanBatch>(IPC.IntakeScan, {
      repoPath,
      sources,
      manualFiles: manualFiles.split('\n').map((s) => s.trim()).filter(Boolean),
      manualSkills: manualSkills.split('\n').map((s) => s.trim()).filter(Boolean),
    });
    setScan(batch);
    if (batch.cancelled) { setNotice('扫描已取消：未产生候选，也未批准任何资产'); return; }
    const set = await invoke<CandidateSet>(IPC.IntakeCompare, { repoPath, batchId: batch.batch_id });
    setCandidates(set);
    setStep('review');
    setSelected(set.candidates[0]?.candidate_id ?? null);
  });

  const cancel = async () => {
    try { await invoke(IPC.IntakeCancel, { repoPath }); }
    catch (failure) { setError((failure as Error).message); }
  };

  const selectAllNew = () => {
    if (!candidates) return;
    const { next, skipped } = selectAllAsNew(candidates.candidates, decisions);
    setDecisions(next);
    setNotice(skipped.length
      ? `已对 ${Object.keys(next).length - Object.keys(decisions).length} 项批量选择「新增」；${skipped.length} 项冲突/无法解析需要逐项明确选择`
      : '已批量选择「新增」');
  };

  const buildPlan = () => run('生成计划', async () => {
    if (!candidates) return;
    const decisionsList: PlanDecision[] = Object.entries(decisions).map(([candidate_id, kind]) => {
      if (!needsTarget(kind)) return { candidate_id, kind };
      const chosen = targets[candidate_id] ?? defaultTargetFor(detailOf(candidate_id) as Candidate) ?? undefined;
      return chosen ? { candidate_id, kind, target_asset_id: chosen } : { candidate_id, kind };
    });
    const p = await invoke<ReviewPlan>(IPC.IntakePlan, { repoPath, batchId: candidates.batch_id, decisions: decisionsList });
    setPlan(p);
    setStep('plan');
    setApplyResult(null);
  });

  const applyPlan = () => run('入库中', async () => {
    if (!plan) return;
    const res = await invoke<ApplyBatch>(IPC.IntakeApply, { repoPath, planId: plan.plan_id });
    setApplyResult(res);
    setStep('result');
    await refreshHistory(repoPath);
    if (res.status !== 'ok' && res.status !== 'already_applied') {
      setNotice('入库未完成：计划可能已过期或来源/目标已变化。你的动作选择已保留，请重新生成计划后再执行。');
    }
  });

  // 失败的中途执行可以续跑（引擎按幂等键跳过已完成动作）；过期计划续跑无意义，需重新生成
  const resumeApply = () => run('继续入库', async () => {
    if (!plan) return;
    const res = await invoke<ApplyBatch>(IPC.IntakeApply, { repoPath, planId: plan.plan_id, resume: true });
    setApplyResult(res);
    setStep('result');
    await refreshHistory(repoPath);
  });

  const rollback = (applyId: string) => run('回退中', async () => {
    const res = await invoke<ApplyBatch>(IPC.IntakeRollback, { repoPath, applyId });
    setApplyResult(res);
    setStep('result');
    await refreshHistory(repoPath);
  });

  const detailOf = (id: string) => candidates?.candidates.find((c) => c.candidate_id === id) ?? null;
  const detail = detailOf(selected ?? '');
  const repoAssets: RepoAssetRef[] = candidates?.repo_asset_list ?? [];
  const detailOptions = detail ? targetOptionsFor(detail, repoAssets) : [];
  const detailTarget = detail
    ? (targets[detail.candidate_id] ?? defaultTargetFor(detail) ?? '')
    : '';
  const unresolvedCount = plan?.unresolved.length ?? 0;
  const canScan = Boolean(repoPath) && (sources.length > 0 || manualFiles.trim() || manualSkills.trim());

  return (
    <div className={`intake-page ${step !== 'sources' ? 'intake-focused' : ''}`}>
      <div className="eyebrow">WORKSPACE / INTAKE</div>
      <div className="page-heading"><div><h1>{{ sources: '配置收编', review: '审核待收编配置', plan: '确认入库计划', result: '查看执行结果' }[step]}</h1><p className="muted">已有项目配置，审核后集中入库。</p></div><span className="badge">人工审核</span></div>
      <nav className="intake-steps" aria-label="收编步骤">
        {([
          ['sources', '选择来源', true],
          ['review', '审核候选', Boolean(candidates)],
          ['plan', '预览计划', Boolean(plan)],
          ['result', '查看结果', Boolean(applyResult)],
        ] as const).map(([key, label, available], index) => <button key={key} type="button"
          aria-current={step === key ? 'step' : undefined} className={step === key ? 'active' : ''}
          disabled={!available || Boolean(busy)} onClick={() => setStep(key)}><span>{index + 1}</span>{label}</button>)}
      </nav>
      {busy && <div className="notice" role="status">{busy}… {progress}<button onClick={cancel}>取消</button></div>}
      {error && <div className="error" role="alert">{error}</div>}
      {notice && <div className="notice" role="status">{notice}</div>}
      <fieldset className="source-panel" hidden={step !== 'sources'} disabled={Boolean(busy)}>
      <legend className="sr-only">来源设置</legend>
      <p className="muted">
        扫描四类工具的既有配置，逐项人工审核后入库到总库。全程只读来源；取消不会批准任何资产。
      </p>

      <div className="form">
        <label className="muted">总库路径（必须是已初始化的 AI Workspace）</label>
        <input readOnly={lockedLibrary} aria-label="总库路径" className="input" value={repoPath} onChange={(e) => setRepoPath(e.target.value)} placeholder="/Users/me/ai-workspace" />
        {lockedLibrary && <p className="muted">入库到当前统一内容库，更换位置请前往“内容库存放位置”。</p>}
      </div>

      <h3>来源</h3>
      <p className="muted">来源项目不需要安装 AI Workspace，也不要求是 git 仓库。</p>
      <ul className="master" style={{ width: '100%', borderRight: 'none', maxHeight: 160 }}>
        {sources.map((s, i) => (
          <li key={`${s.path}-${i}`} className="repo-item">
            <div className="repo-name">{s.path}</div>
            <div className="repo-path">{s.tool} / {s.scope}</div>
          </li>
        ))}
        {sources.length === 0 && <li className="muted">尚未添加来源</li>}
      </ul>
      <div className="row" style={{ marginTop: 8 }}>
        <input aria-label="来源目录" className="input" placeholder="来源目录，如 /Users/me/project" value={newSource.path}
          onChange={(e) => setNewSource({ ...newSource, path: e.target.value })} />
        <select aria-label="来源工具" className="input source-select" value={newSource.tool} onChange={(e) => setNewSource({ ...newSource, tool: e.target.value })}>
          {TOOL_OPTIONS.map((t) => <option key={t} value={t}>{t === 'auto' ? '自动识别工具' : t}</option>)}
        </select>
        <select aria-label="来源范围" className="input source-select" value={newSource.scope}
          onChange={(e) => setNewSource({ ...newSource, scope: e.target.value as 'project' | 'global' })}>
          <option value="project">项目配置</option>
          <option value="global">全局配置</option>
        </select>
        <button type="button" onClick={addSource}>添加来源</button>
        <button type="button" className="danger" onClick={() => setSources([])}>清空</button>
      </div>
      <details className="advanced-options"><summary>手动补充规则或技能</summary>
      <div className="form" style={{ marginTop: 8 }}>
        <label className="muted">手动补充的规则文件（每行一个路径）</label>
        <textarea className="input" rows={2} value={manualFiles} onChange={(e) => setManualFiles(e.target.value)} />
        <label className="muted">手动补充的 Skill 目录（每行一个路径）</label>
        <textarea className="input" rows={2} value={manualSkills} onChange={(e) => setManualSkills(e.target.value)} />
      </div>

      </details>
      <div className="intake-actionbar">
        <span className="muted">扫描只读取来源配置，不写入来源项目。</span>
        <button className="primary" type="button" onClick={startScan} disabled={!canScan || Boolean(busy)}>开始扫描</button>
      </div>
      </fieldset>

      {scan && (
        <details className="scan-summary" open={scan.errors.length > 0 && step === 'review'}>
          <summary>扫描结果 · {scan.sources.length} 个来源 · {scan.errors.length} 条提示</summary>
          <div className="muted">
            批次 {scan.batch_id}：来源 {scan.sources.length} 个，记录 {scan.occurrences.length} 条，错误 {scan.errors.length} 条
          </div>
          {scan.errors.length > 0 && (
            <ul className="muted">
              {scan.errors.slice(0, 8).map((e, i) => (
                <li key={`${e.path}-${i}`}>[{e.level}] {e.source ?? '?'} {e.path ?? ''}: {e.message}</li>
              ))}
            </ul>
          )}
        </details>
      )}

      {candidates && (
        <section className="review-panel" hidden={step !== 'review'}>
          <h3>候选审核</h3>
          <div className="muted">
            共 {candidates.candidates.length} 项；
            {Object.entries(candidates.summary).filter(([key, value]) => key !== 'total' && value > 0).map(([key, value]) => `${LABEL_LABELS[key as CandidateLabel] ?? (key === 'deferred' ? '暂缓' : key)} ${value}`).join('，')}
          </div>
          <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={selectAllNew} disabled={Boolean(busy)}>全选新增（跳过冲突/无法解析）</button>
            <button type="button" onClick={() => setDecisions({})} disabled={Boolean(busy)}>清空动作</button>
          </div>

          <fieldset className="review-controls" disabled={Boolean(busy)}>
          <div className="master-detail intake-review" style={{ marginTop: 12 }}>
            <ul className="master">
              {candidates.candidates.map((c) => (
                <li key={c.candidate_id}>
                  <button type="button" aria-pressed={c.candidate_id === selected}
                    className={c.candidate_id === selected ? 'repo-item active' : 'repo-item'}
                    onClick={() => setSelected(c.candidate_id)}>
                  <div className="repo-name">{c.display_name || c.candidate_id}</div>
                  <div className="repo-path">
                    {c.type} · {c.labels.map((l) => LABEL_LABELS[l] ?? l).join('/')}
                    {decisions[c.candidate_id] ? ` · 已选：${ACTION_LABELS[decisions[c.candidate_id]]}` : ''}
                  </div>
                  </button>
                </li>
              ))}
              {candidates.candidates.length === 0 && <li className="muted">没有候选</li>}
            </ul>
            <div className="detail">
              {detail ? (
                <>
                  <h3>{detail.display_name}</h3>
                  <div className="muted">
                    类型 {detail.type} · 标签 {detail.labels.map((l) => LABEL_LABELS[l] ?? l).join('、')}
                  </div>
                  {detail.existing_source && (
                    <div className="muted">总库既有：{detail.existing_source.path}</div>
                  )}
                  <div className="muted" style={{ marginTop: 8 }}>来源（{detail.sources.length}）</div>
                  <table className="table">
                    <thead><tr><th>工具</th><th>scope</th><th>路径</th><th>状态</th></tr></thead>
                    <tbody>
                      {detail.sources.map((s) => (
                        <tr key={s.occurrence_id}>
                          <td>{s.source.tool}</td>
                          <td>{s.source.scope}</td>
                          <td>{s.source.path}</td>
                          <td>{s.read_status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <DiffBlock title="内容差异" diff={detail.diff_summary} />
                  <DiffBlock title="MCP 行为字段差异" diff={detail.behavior_diff} />
                  <DiffBlock title="MCP 凭据绑定差异" diff={detail.credential_diff} />
                  <div style={{ marginTop: 12 }}>
                    <div className="muted">动作</div>
                    <ActionButtons value={decisions[detail.candidate_id]}
                      onPick={(k) => {
                        setDecisions({ ...decisions, [detail.candidate_id]: k });
                        if (!needsTarget(k)) {
                          const next = { ...targets };
                          delete next[detail.candidate_id];
                          setTargets(next);
                        }
                      }} />
                    {detail.labels.some((l) => RISK_SET.has(l)) && (
                      <div className="muted" style={{ marginTop: 4 }}>该项含冲突或无法解析标记，需要你明确选择动作</div>
                    )}
                  </div>
                  {needsTarget(decisions[detail.candidate_id]) && (
                    <div style={{ marginTop: 12 }}>
                      <div className="muted">目标资产（{ACTION_LABELS[decisions[detail.candidate_id] as ActionKind]}会作用在这一项上）</div>
                      {detailOptions.length === 0 ? (
                        <div className="error">
                          总库没有同类型的可关联资产，{ACTION_LABELS[decisions[detail.candidate_id] as ActionKind]}无法执行；请改用「新增」
                        </div>
                      ) : (
                        <>
                          <select aria-label="目标资产" className="input" value={detailTarget}
                            onChange={(e) => setTargets({ ...targets, [detail.candidate_id]: e.target.value })}>
                            <option value="">（未选择）</option>
                            {detailOptions.map((o) => (
                              <option key={o.asset_id} value={o.asset_id}>
                                {o.name || o.path}{o.registered ? ` · v${o.version ?? '?'}` : ' · 未纳管'}
                              </option>
                            ))}
                          </select>
                          {(() => {
                            const chosen = detailOptions.find((o) => o.asset_id === detailTarget);
                            if (!chosen) return <div className="muted">未选择目标时不能生成可执行的计划</div>;
                            return (
                              <div className="muted">
                                写入目标：{chosen.path}
                                {chosen.registered ? `（当前 v${chosen.version ?? '?'}）` : '（首次纳管，登记为初始版本）'}
                              </div>
                            );
                          })()}
                        </>
                      )}
                    </div>
                  )}
                </>
              ) : <div className="muted">选择左侧候选查看详情</div>}
            </div>
          </div>
          </fieldset>
          <div className="intake-actionbar"><span className="muted">已选择 {Object.keys(decisions).length} / {candidates.candidates.length} 项</span>
            <button className="primary" type="button" onClick={buildPlan} disabled={Boolean(busy)}>生成计划</button></div>
        </section>
      )}

      {plan && (
        <section className="plan-panel" hidden={step !== 'plan'}>
          <h2>计划预览</h2>
          <div className="muted">
            计划 {plan.plan_id} · 动作 {plan.actions.length} 项
            {unresolvedCount > 0 ? ` · 未处理 ${unresolvedCount} 项` : ''}
          </div>
          <table className="table">
            <thead><tr><th>动作</th><th>类型</th><th>名称</th><th>目标</th></tr></thead>
            <tbody>
              {plan.actions.map((a) => (
                <tr key={a.action_id}>
                  <td>{ACTION_LABELS[a.kind]}</td>
                  <td>{a.asset_type}</td>
                  <td>{a.asset_name}</td>
                  <td>
                    {a.write_path ?? (a.target_asset_id
                      ? `${repoAssets.find((o) => o.asset_id === a.target_asset_id)?.name ?? a.target_asset_id}${a.target_path ? ` → ${a.target_path}` : ''}`
                      : '—')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {unresolvedCount > 0 && (
            <div className="error">
              仍有 {unresolvedCount} 项冲突或无法解析未给出动作，无法执行入库。请为这些候选选择动作后重新生成计划。
            </div>
          )}
          <div className="intake-actionbar">
            <button type="button" onClick={() => setStep('review')} disabled={Boolean(busy)}>返回审核</button>
            <button type="button" onClick={buildPlan} disabled={Boolean(busy)}>重新生成计划</button>
            <button className="primary" type="button" onClick={applyPlan} disabled={unresolvedCount > 0 || Boolean(busy)}>执行入库</button>
          </div>
        </section>
      )}

      {applyResult && (
        <section className="result-panel" hidden={step !== 'result'}>
          <h3>入库结果</h3>
          <div className="muted">
            执行 {applyResult.apply_id} · 状态 {EXECUTION_STATUS_LABELS[applyResult.status] ?? applyResult.status}
          </div>
          {applyResult.rollback && <div role="status">回退状态：{applyResult.rollback.status === 'rolled_back' ? '已回退' : applyResult.rollback.status}</div>}
          <table className="table">
            <thead><tr><th>阶段</th><th>状态</th></tr></thead>
            <tbody>
              {applyResult.stages.map((s) => <tr key={s.stage}><td>{EXECUTION_STAGE_LABELS[s.stage] ?? s.stage}</td><td>{EXECUTION_STATUS_LABELS[s.status] ?? s.status}</td></tr>)}
            </tbody>
          </table>
          {applyResult.files.length > 0 && (
            <>
              <div className="muted" style={{ marginTop: 8 }}>变更文件</div>
              <ul className="muted">{applyResult.files.map((f) => <li key={f.rel}>{f.rel}（{FILE_OPERATION_LABELS[f.op] ?? f.op}）</li>)}</ul>
            </>
          )}
          {applyResult.errors.length > 0 && (
            <div className="error">错误：{applyResult.errors.join('、')}</div>
          )}
          {applyResult.failed_actions.length > 0 && (
            <div className="error">失败动作：{JSON.stringify(applyResult.failed_actions)}</div>
          )}
          {applyResult.status === 'failed' && (
            <div className="row" style={{ marginTop: 12 }}>
              <button type="button" onClick={resumeApply} disabled={Boolean(busy)}>继续未完成项</button>
              <button type="button" onClick={buildPlan} disabled={Boolean(busy)}>重新生成计划</button>
            </div>
          )}
        </section>
      )}

      <details className="intake-history" open={Boolean(historyError)}>
        <summary>入库记录 <span className="badge">{history.length}</span></summary>
        {historyError && (
          <div className="error">
            {historyError}
            <button type="button" style={{ marginLeft: 8 }} onClick={() => refreshHistory(repoPath)}>重试</button>
          </div>
        )}
        <table className="table">
          <thead><tr><th>执行</th><th>状态</th><th>已应用</th><th>失败</th><th /></tr></thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.apply_id}>
                <td>{h.apply_id}</td>
                <td>{h.rollback?.status === 'rolled_back' ? '已回退' : h.rollback?.status ?? EXECUTION_STATUS_LABELS[h.status] ?? h.status}</td>
                <td>{h.applied_actions}</td>
                <td>{h.failed_actions}</td>
                <td>
                  <button type="button" className="danger" disabled={Boolean(busy) || h.rollback?.status === 'rolled_back'}
                    onClick={() => rollback(h.apply_id)}>回退</button>
                </td>
              </tr>
            ))}
            {history.length === 0 && !historyError && <tr><td colSpan={5} className="muted">暂无入库记录</td></tr>}
          </tbody>
        </table>
      </details>
      <p className="section-note">AI 辅助整理暂未开放。当前通过人工审核完成收编，无需配置模型服务。</p>
    </div>
  );
}
