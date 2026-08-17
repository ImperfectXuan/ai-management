// electron/src/core/git.ts
import { execFile } from 'node:child_process';
import { WorkspaceError, ErrorCodes } from './errors';

export async function isGitInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('git', ['--version'], (err) => resolve(!err));
  });
}

export async function runGit(
  args: string[],
  opts: { cwd?: string } = {}
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: opts.cwd }, (err, stdout, stderr) => {
      if (err) {
        const code = typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1;
        resolve({ stdout: String(stdout), stderr: String(stderr || err.message), code });
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr), code: 0 });
    });
  });
}

export async function gitRoot(dir: string): Promise<string> {
  const res = await runGit(['rev-parse', '--show-toplevel'], { cwd: dir });
  if (res.code !== 0) {
    throw new WorkspaceError(ErrorCodes.NotAGitRepo, `'${dir}' 不是 git 仓库`);
  }
  return res.stdout.trim();
}
