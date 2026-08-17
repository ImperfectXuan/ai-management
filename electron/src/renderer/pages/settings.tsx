// electron/src/renderer/pages/settings.tsx
import React, { useState } from 'react';

export function SettingsPage(_props: { repoId: string }) {
  const [lang, setLang] = useState<'zh' | 'en'>('zh');
  const [notify, setNotify] = useState(true);
  return (
    <div style={{ maxWidth: 480 }}>
      <h2>设置</h2>
      <div className="rule-row">
        <label>语言</label>
        <select value={lang} onChange={(e) => setLang(e.target.value as 'zh' | 'en')} className="input">
          <option value="zh">简体中文</option>
          <option value="en">English</option>
        </select>
      </div>
      <div className="rule-row">
        <label>同步完成通知</label>
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
      </div>
      <p className="muted">语言与通知的持久化在后续版本实现；当前为界面占位。</p>
    </div>
  );
}
