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
    const env = { ...process.env, AIWS_ROOT: root, ...(args.includes('--json') ? { AIWS_JSON: '1' } : {}) };
    execFile(aiws, args, { cwd: root, env, timeout: 15_000 }, (err, stdout, stderr) => {
      if (err) {
        if (typeof (err as { code?: unknown }).code === 'number') {
          resolve({ stdout: String(stdout), stderr: String(stderr), code: (err as { code: number }).code });
          return;
        }
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          resolve({ stdout: '', stderr: '', code: 127 });
          return;
        }
        console.error('[aiws:bridge] 子进程启动或执行失败', { root, operation: args[0], code: (err as NodeJS.ErrnoException).code });
        resolve({ stdout: String(stdout), stderr: 'CLI 启动失败、超时或被信号终止', code: 1 });
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr), code: 0 });
    });
  });
}

/** 执行只读 CLI JSON 命令。失败或非法输出抛出 CliFailed，不伪装成空数据。 */
export async function runAiwsJson(root: string, args: string[]): Promise<unknown> {
  const result = await runAiwsBridge(root, args);
  if (result.code !== 0) {
    throw new WorkspaceError(ErrorCodes.CliFailed, `aiws ${args.slice(0, 2).join(' ')} 失败（退出码 ${result.code}），请检查 CLI 与工作区依赖`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new WorkspaceError(ErrorCodes.CliFailed, `aiws ${args.slice(0, 2).join(' ')} 返回无效 JSON，请检查 CLI 版本`);
  }
}

export async function assertAiws(root: string): Promise<void> {
  const aiws = path.join(root, '.ai-workspace', 'scripts', 'aiws');
  const res = await runAiwsBridge(root, ['--version']);
  if (res.code === 127 || res.code === 126) {
    throw new WorkspaceError(ErrorCodes.AiwsNotInstalled, `'${root}' 未初始化 AI Workspace（缺 ${aiws}）`);
  }
}
