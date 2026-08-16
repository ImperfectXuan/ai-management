// electron/src/renderer/pages/secrets.tsx
import React, { useEffect, useState } from 'react';
import { invoke } from '../api';
import { IPC } from '../../shared/ipc';

interface SecretsList {
  secrets: string[];
  vault_ready: boolean;
  error?: string;
}

interface SecretsAuditTool {
  tool: string;
  allowed: string[];
}

interface SecretsAudit {
  tools: SecretsAuditTool[];
  mcp_refs?: unknown[];
}

export function SecretsPage({ repoId }: { repoId: string }) {
  const [list, setList] = useState<SecretsList | null>(null);
  const [audit, setAudit] = useState<SecretsAudit | null>(null);
  useEffect(() => {
    invoke<SecretsList>(IPC.SecretsList, repoId).then(setList).catch(() => setList({ secrets: [], vault_ready: false, error: '无法读取' }));
    invoke<SecretsAudit>(IPC.SecretsAudit, repoId).then(setAudit).catch(() => setAudit({ tools: [] }));
  }, [repoId]);

  return (
    <div>
      <h2>密钥（只读）</h2>
      {list?.vault_ready === false && (
        <div className="error">vault 未初始化。安装依赖: brew install age oath-toolkit，然后 aiws setup</div>
      )}
      <p className="muted">vault_ready: {String(list?.vault_ready)}</p>
      <table className="table">
        <thead><tr><th>工具</th><th>可用密钥</th></tr></thead>
        <tbody>
          {(audit?.tools ?? []).map((t) => (
            <tr key={t.tool}><td>{t.tool}</td><td>{t.allowed.length ? t.allowed.join(', ') : '(无)'}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
