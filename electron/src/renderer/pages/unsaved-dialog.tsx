// electron/src/renderer/pages/unsaved-dialog.tsx
import React from 'react';

export interface UnsavedChangesDialogProps {
  busy?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function UnsavedChangesDialog({ busy = false, onSave, onDiscard, onCancel }: UnsavedChangesDialogProps) {
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="unsaved-title">
        <h3 id="unsaved-title">有未保存的更改</h3>
        <p className="muted">继续前要保存对当前规则的修改吗？</p>
        <div className="row dialog-actions">
          <button type="button" onClick={onSave} disabled={busy}>{busy ? '保存中…' : '保存并继续'}</button>
          <button type="button" className="secondary" onClick={onDiscard} disabled={busy}>放弃更改</button>
          <button type="button" className="secondary" onClick={onCancel} disabled={busy}>取消</button>
        </div>
      </div>
    </div>
  );
}
