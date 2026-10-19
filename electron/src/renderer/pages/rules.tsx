// electron/src/renderer/pages/rules.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '../api';
import { IPC } from '../../shared/ipc';
import { PER_FILE_TOOLS, type PerFileTool } from '../../shared/tools';
import type { Rule, RuleDocument } from '../../core/rules';
import { RuleEditor, type RuleDraft } from './rule-editor';
import type { BodyEditorHandle, BodyEditorProps } from '../markdown-editor';
import { UnsavedChangesDialog } from './unsaved-dialog';

const TOOL_LABELS: Record<PerFileTool, string> = {
  cursor: 'Cursor',
  trae: 'Trae',
};

export interface RulesGuard {
  save: () => Promise<boolean>;
  discard: () => void;
}

export interface RulesPageProps {
  repoId: string;
  canSync?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  guardRef?: React.MutableRefObject<RulesGuard | null>;
  /** 测试注入点：默认使用 Milkdown 富文本编辑器。 */
  BodyEditor?: React.ComponentType<BodyEditorProps>;
}

export function RulesPage({
  repoId,
  canSync = true,
  onDirtyChange,
  guardRef,
  BodyEditor,
}: RulesPageProps) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [tool, setTool] = useState<PerFileTool>('cursor');
  const [selected, setSelected] = useState<{ id: string; domain: boolean } | null>(null);
  const [doc, setDoc] = useState<RuleDocument | null>(null);
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<{ run: () => void } | null>(null);
  const bodyHandleRef = useRef<BodyEditorHandle | null>(null);

  const load = useCallback(async (): Promise<Rule[]> => {
    try {
      const list = await invoke<Rule[]>(IPC.RulesList, repoId);
      setRules(list);
      setError('');
      return list;
    } catch (failure) {
      setError((failure as Error).message);
      return [];
    }
  }, [repoId]);

  const openRule = useCallback(async (id: string, domain: boolean) => {
    setLoading(true);
    setError('');
    try {
      const next = await invoke<RuleDocument>(IPC.RulesGet, { id, domain });
      setSelected({ id, domain });
      setDoc(next);
      setDraft({ fields: next.fields, body: next.body });
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await load();
      if (cancelled || list.length === 0) return;
      await openRule(list[0].id, list[0].domain);
    })();
    return () => { cancelled = true; };
  }, [load, openRule]);

  const dirty = useMemo(() => {
    if (!doc || !draft) return false;
    return JSON.stringify(doc.fields) !== JSON.stringify(draft.fields) || doc.body !== draft.body;
  }, [doc, draft]);

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!doc || !draft) return false;
    setSaving(true);
    setError('');
    try {
      const fields = {
        ...draft.fields,
        title: draft.fields.title.trim(),
        description: draft.fields.description.trim(),
        scope: draft.fields.scope.trim(),
        globs: draft.fields.globs.map((glob) => glob.trim()).filter(Boolean),
      };
      await invoke(IPC.RulesSave, {
        id: doc.id,
        domain: doc.domain,
        expectedVersion: doc.version,
        fields,
        body: bodyHandleRef.current?.flush() ?? draft.body,
      });
      const reloaded = await invoke<RuleDocument>(IPC.RulesGet, { id: doc.id, domain: doc.domain });
      setDoc(reloaded);
      setDraft({ fields: reloaded.fields, body: reloaded.body });
      setMsg('已保存；规则等待同步');
      await load();
      return true;
    } catch (failure) {
      setError((failure as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }, [doc, draft, load]);

  // 放弃更改回到最近一次读取的磁盘内容；随后若发生导航，目标规则会重新读取。
  const discard = useCallback(() => {
    if (!doc) return;
    setDraft({ fields: doc.fields, body: doc.body });
    setError('');
  }, [doc]);

  const reload = useCallback(() => {
    if (doc) void openRule(doc.id, doc.domain);
  }, [doc, openRule]);

  useEffect(() => {
    if (!guardRef) return;
    guardRef.current = { save, discard };
    return () => { guardRef.current = null; };
  }, [guardRef, save, discard]);

  const guarded = useCallback((run: () => void) => {
    if (dirty) setPending({ run });
    else run();
  }, [dirty]);

  const changeTool = (next: PerFileTool) => guarded(() => setTool(next));

  const selectRule = (rule: Rule) => {
    if (selected?.id === rule.id && selected.domain === rule.domain) return;
    guarded(() => { void openRule(rule.id, rule.domain); });
  };

  const toggle = async (rule: Rule) => {
    try {
      const newValue = !rule.requiredByTool[tool];
      await invoke(IPC.RulesSetRequired, { repoId, tool, id: rule.id, domain: rule.domain, value: newValue });
      await load();
    } catch (failure) { setError((failure as Error).message); }
  };

  const sync = async () => {
    try {
      await invoke(IPC.SyncRun, { repoId, tool, only: 'rules' });
      setMsg(`已同步 ${TOOL_LABELS[tool]} 规则`);
      await load();
    } catch (failure) { setError((failure as Error).message); }
  };

  const confirmSave = async () => {
    if (!pending) return;
    const ok = await save();
    if (ok) {
      const run = pending.run;
      setPending(null);
      run();
    }
  };

  const confirmDiscard = () => {
    if (!pending) return;
    const run = pending.run;
    discard();
    setPending(null);
    run();
  };

  return (
    <div>
      <h2>规则</h2>
      <div className="rules-layout">
      <aside className="rules-list" aria-label="规则列表">
        <div className="row rules-toolbar">
          <span className="muted">工具:</span>
          <div style={{ display: 'inline-flex', gap: 4 }}>
            {PER_FILE_TOOLS.map((item) => (
              <button
                key={item}
                onClick={() => changeTool(item)}
                className={item === tool ? 'tab tab-active' : 'tab'}
                type="button"
              >
                {TOOL_LABELS[item]}
              </button>
            ))}
          </div>
        </div>
        {msg && <div className="muted">{msg}</div>}
        {rules.map((rule) => {
          const active = selected?.id === rule.id && selected.domain === rule.domain;
          return (
            <div
              key={`${rule.domain ? 'domain' : 'root'}:${rule.id}`}
              className={`rule-row ${active ? 'rule-row-active' : ''}`}
              role="button"
              tabIndex={0}
              aria-pressed={active}
              onClick={() => selectRule(rule)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  selectRule(rule);
                }
              }}
            >
              <label className="switch" onClick={(event) => event.stopPropagation()}>
                <input
                  type="checkbox"
                  aria-label={`常驻加载 ${rule.id}`}
                  checked={rule.requiredByTool[tool] ?? false}
                  onChange={() => void toggle(rule)}
                />
                <span className="slider" />
              </label>
              <div>
                <div className="repo-name">{rule.title || rule.id}</div>
                <div className="repo-path">
                  {rule.id} · scope: {rule.scope} · globs: {rule.globs} {rule.domain ? '· 领域' : ''}
                </div>
              </div>
            </div>
          );
        })}
        {rules.length === 0 && <div className="muted">未找到规则（先确认内容库已初始化 AI Workspace）。</div>}
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={() => void sync()} disabled={!canSync}>同步 {TOOL_LABELS[tool]} 规则</button>
        </div>
      </aside>

      <section className="rule-detail" aria-label="规则详情">
        {loading && <p className="muted">正在加载规则…</p>}
        {!loading && doc && draft && (
          <RuleEditor
            key={`${doc.id}:${doc.version}`}
            document={doc}
            draft={draft}
            saving={saving}
            error={error}
            onChange={setDraft}
            onSave={() => void save()}
            onReload={reload}
            BodyEditor={BodyEditor}
            bodyHandleRef={bodyHandleRef}
          />
        )}
        {!loading && !doc && (
          <>
            <p className="muted">选择左侧规则查看与编辑内容。</p>
            {error && <div className="error" role="alert">{error}</div>}
          </>
        )}
      </section>

      {pending && (
        <UnsavedChangesDialog
          busy={saving}
          onSave={() => void confirmSave()}
          onDiscard={confirmDiscard}
          onCancel={() => setPending(null)}
        />
      )}
      </div>
    </div>
  );
}
