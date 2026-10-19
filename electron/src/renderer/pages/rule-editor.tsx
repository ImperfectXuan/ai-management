// electron/src/renderer/pages/rule-editor.tsx
import React, { useEffect } from 'react';
import type { RuleDocument, RuleFields } from '../../core/rules';
import { SUPPORTED_TOOLS, type SupportedTool } from '../../shared/tools';
import type { BodyEditorHandle, BodyEditorProps } from '../markdown-editor';

export interface RuleDraft {
  fields: RuleFields;
  body: string;
}

// 编辑器按需加载：jsdom 测试注入替身时不会触发 Milkdown（ESM-only）的模块加载。
const DefaultBodyEditor = React.lazy(async () => {
  const module = await import('../markdown-editor');
  return { default: module.RuleMarkdownEditor };
});

export interface RuleEditorProps {
  document: RuleDocument;
  draft: RuleDraft;
  saving: boolean;
  error: string;
  onChange: (draft: RuleDraft) => void;
  onSave: () => void;
  onReload: () => void;
  BodyEditor?: React.ComponentType<BodyEditorProps>;
  bodyHandleRef?: React.MutableRefObject<BodyEditorHandle | null>;
}

// Milkdown 不覆盖原始 HTML 块；命中时降级为源码编辑，避免保存时丢失内容。
export function hasUnsupportedMarkdown(body: string): boolean {
  const withoutFences = body.replace(/```[\s\S]*?```/g, '').replace(/~~~[\s\S]*?~~~/g, '');
  return /^[ \t]*<\/?[A-Za-z][^>]*>/m.test(withoutFences);
}

export function RuleEditor({
  document: doc,
  draft,
  saving,
  error,
  onChange,
  onSave,
  onReload,
  BodyEditor,
  bodyHandleRef,
}: RuleEditorProps) {
  const updateField = <K extends keyof RuleFields>(field: K, value: RuleFields[K]) => {
    onChange({ ...draft, fields: { ...draft.fields, [field]: value } });
  };
  const allTools = draft.fields.tools.length === 0;
  const toggleTool = (tool: SupportedTool) => {
    const current = allTools ? [] : draft.fields.tools;
    const next = current.includes(tool) ? current.filter((item) => item !== tool) : [...current, tool];
    updateField('tools', next);
  };
  const sourceMode = hasUnsupportedMarkdown(draft.body);
  const Editor = BodyEditor ?? DefaultBodyEditor;
  // 源码模式由受控 textarea 直接写 draft，不需要 flush 句柄；清掉旧句柄避免误用。
  useEffect(() => {
    if (sourceMode && bodyHandleRef) bodyHandleRef.current = null;
  }, [sourceMode, bodyHandleRef]);

  return (
    <section className="rule-editor" aria-label="规则编辑器">
      <header className="rule-editor-header">
        <div>
          <h2>{draft.fields.title || doc.id}</h2>
          <div className="repo-path">{doc.relativePath}</div>
        </div>
        <button type="button" onClick={onSave} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
      </header>

      {error && (
        <div className="error" role="alert">
          {error}
          <button type="button" className="secondary" onClick={onReload}>重新加载</button>
        </div>
      )}

      <div className="rule-fields">
        <label>
          <span>id</span>
          <input className="input" value={doc.id} readOnly disabled aria-label="规则 id" />
        </label>
        <label>
          <span>标题</span>
          <input className="input" value={draft.fields.title} onChange={(event) => updateField('title', event.target.value)} />
        </label>
        <label>
          <span>描述</span>
          <input className="input" value={draft.fields.description} onChange={(event) => updateField('description', event.target.value)} />
        </label>
        <label>
          <span>scope</span>
          <input className="input" value={draft.fields.scope} onChange={(event) => updateField('scope', event.target.value)} />
        </label>
        <label className="rule-globs">
          <span>globs（每行一个）</span>
          <textarea
            className="input"
            rows={2}
            value={draft.fields.globs.join('\n')}
            onChange={(event) => updateField('globs', event.target.value.split('\n'))}
          />
        </label>
        <div className="rule-tools">
          <span className="muted">tools</span>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={allTools}
              onChange={(event) => updateField('tools', event.target.checked ? [] : [...SUPPORTED_TOOLS])}
            />
            全部工具
          </label>
          {!allTools && SUPPORTED_TOOLS.map((tool) => (
            <label key={tool} className="checkbox">
              <input type="checkbox" checked={draft.fields.tools.includes(tool)} onChange={() => toggleTool(tool)} />
              {tool}
            </label>
          ))}
        </div>
      </div>

      <div className="rule-body">
        {sourceMode ? (
          <>
            <p className="muted">正文包含编辑器不支持的语法，已切换为源码模式。</p>
            <textarea
              className="input rule-source"
              aria-label="规则正文源码"
              value={draft.body}
              onChange={(event) => onChange({ ...draft, body: event.target.value })}
            />
          </>
        ) : (
          <div className="rule-editor-surface">
            <React.Suspense fallback={<p className="muted">正在加载编辑器…</p>}>
              <Editor
                value={draft.body}
                onChange={(body) => onChange({ ...draft, body })}
                disabled={saving}
                onReady={bodyHandleRef ? (handle) => { bodyHandleRef.current = handle; } : undefined}
              />
            </React.Suspense>
          </div>
        )}
      </div>
    </section>
  );
}
