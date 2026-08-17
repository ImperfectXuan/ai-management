// electron/src/core/vault-bridge.ts
import { execFile } from 'node:child_process';
import path from 'node:path';
import { WorkspaceError, ErrorCodes } from './errors';

export async function runAiwsBridge(
  root: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; code: number }> {
  const aiws = path.join(root, '.ai-workspace', 'scripts', 'aiws');
  return new Promise((resolve) => {
    execFile(aiws, args, { cwd: root, timeout: 15_000 }, (err, stdout, stderr) => {
      if (err) {
        if (typeof (err as { code?: unknown }).code === 'number') {
          resolve({ stdout: String(stdout), stderr: String(stderr), code: (err as { code: number }).code });
          return;
        }
        if (String((err as { message?: string }).message ?? '').includes('ENOENT')) {
          resolve({ stdout: '', stderr: '', code: 127 });
          return;
        }
      }
      resolve({ stdout: String(stdout), stderr: String(stderr), code: 0 });
    });
  });
}

export async function assertAiws(root: string): Promise<void> {
  const aiws = path.join(root, '.ai-workspace', 'scripts', 'aiws');
  const res = await runAiwsBridge(root, ['--version']);
  if (res.code === 127 || res.code === 126) {
    throw new WorkspaceError(ErrorCodes.AiwsNotInstalled, `'${root}' 未初始化 AI Workspace（缺 ${aiws}）`);
  }
}
