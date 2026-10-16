import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import { WorkspaceError, ErrorCodes } from './errors';
import { SUPPORTED_TOOLS } from '../shared/tools';

export interface SyncOptions {
  libraryRoot?: string;
  cliPath?: string;
  scope?: 'global' | 'project';
  tool?: string;
  only?: 'rules' | 'mcp' | 'skills';
  /** 单元回执落盘路径（绝对路径）；与 operationId 成对出现（design §4）。 */
  reportFile?: string;
  /** 主进程生成的操作 ID，经 AIWS_SYNC_OPERATION_ID 传给 CLI。 */
  operationId?: string;
}

const SYNC_TIMEOUT_MS = 300_000;
const KILL_GRACE_MS = 1_000;

function syncArgs(opts: SyncOptions): string[] {
  if (opts.tool && !SUPPORTED_TOOLS.some((tool) => tool === opts.tool)) {
    throw new WorkspaceError(ErrorCodes.UnsupportedTool, `不支持的同步工具：${opts.tool}`);
  }
  if (opts.scope && !['global', 'project'].includes(opts.scope)) {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, '同步 scope 必须是 project 或 global');
  }
  if (opts.only && !['rules', 'mcp', 'skills'].includes(opts.only)) {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, '同步模块必须是 rules、mcp 或 skills');
  }
  if (opts.reportFile !== undefined || opts.operationId !== undefined) {
    if (!opts.reportFile || !opts.operationId) {
      throw new WorkspaceError(ErrorCodes.InvalidArgument, 'reportFile 与 operationId 必须同时提供');
    }
    if (!path.isAbsolute(opts.reportFile)) {
      throw new WorkspaceError(ErrorCodes.InvalidArgument, 'reportFile 必须是绝对路径');
    }
    if (!opts.tool || !opts.scope || !opts.only) {
      throw new WorkspaceError(ErrorCodes.InvalidArgument, '回执模式需要同时指定 tool、scope 与 only（单一单元）');
    }
  }
  const args = ['sync', '--scope', opts.scope ?? 'project'];
  if (opts.tool) args.push('--tool', opts.tool);
  if (opts.only) args.push('--only', opts.only);
  if (opts.reportFile) args.push('--report-file', opts.reportFile);
  return args;
}

/** 桌面端复用目标工作区的 CLI 引擎，默认仅写项目范围，逐行报告进度。
 * CLI 缺失、失败、超时或取消均抛错；取消不会报告“同步完成”。
 */
export async function* syncRun(root: string, opts: SyncOptions = {}, signal?: AbortSignal): AsyncGenerator<string> {
  const args = syncArgs(opts);
  if (signal?.aborted) throw new WorkspaceError(ErrorCodes.SyncCancelled, '同步已取消');
  yield '开始同步（项目范围为默认值）';
  const cli = opts.cliPath ?? path.join(opts.libraryRoot ?? root, '.ai-workspace/scripts/aiws');
  const child = spawn(cli, args, {
    cwd: root,
    env: { ...process.env, AIWS_ROOT: root,
      AIWS_SOURCE_DIR: path.join(opts.libraryRoot ?? root, '.ai-workspace'),
      AIWS_RUNTIME_DIR: path.dirname(cli),
      ...(opts.operationId ? { AIWS_SYNC_OPERATION_ID: opts.operationId } : {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
    // 单独的进程组使取消能终止 shell 派生的 jq/cp 等子进程。
    detached: process.platform !== 'win32',
  });
  const output = new PassThrough();
  child.stdout.pipe(output, { end: false });
  child.stderr.pipe(output, { end: false });
  let closed = false;
  let spawnError: Error | undefined;
  child.on('error', (error) => { spawnError = error; });
  const completion = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.on('close', (code, exitSignal) => {
      closed = true;
      output.end();
      resolve({ code, signal: exitSignal });
    });
  });
  const kill = (killSignal: NodeJS.Signals) => {
    if (!child.pid) return;
    try {
      if (process.platform === 'win32') child.kill(killSignal);
      else process.kill(-child.pid, killSignal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') console.error('[sync:cancel]', { root, error });
    }
  };
  let forceKill: NodeJS.Timeout | undefined;
  const stop = () => {
    kill('SIGTERM');
    forceKill ??= setTimeout(() => kill('SIGKILL'), KILL_GRACE_MS);
  };
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; stop(); }, SYNC_TIMEOUT_MS);
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  const lines = createInterface({ input: output });
  try {
    for await (const line of lines) {
      if (signal?.aborted || timedOut) break;
      if (line.trim()) yield line;
    }
    const result = await completion;
    if (signal?.aborted) throw new WorkspaceError(ErrorCodes.SyncCancelled, '同步已取消，部分文件可能已生成，请重新同步');
    if (spawnError || result.code !== 0 || timedOut) {
      console.error('[sync:failed]', { root, args, code: result.code, signal: result.signal, spawnError, timedOut });
      throw new WorkspaceError(ErrorCodes.SyncFailed, timedOut ? '同步超时，请检查 CLI 与依赖' : `同步失败（退出码 ${result.code ?? '未知'}），请检查同步日志与 CLI 安装`);
    }
    yield '同步完成';
  } finally {
    if (!closed) { stop(); await completion; }
    lines.close();
    clearTimeout(timeout);
    clearTimeout(forceKill);
    signal?.removeEventListener('abort', stop);
  }
}

/** 单工具规则生成也经过 CLI，返回规则数和本轮备份文件名。 */
export async function generateRuleFiles(root: string, tool: 'cursor' | 'trae', scope?: string): Promise<{ count: number; backedUp: string[] }> {
  const outDir = path.join(root, `.${tool}`, 'rules');
  const before = new Set(await fs.readdir(outDir).catch(() => [] as string[]));
  for await (const _line of syncRun(root, { tool, only: 'rules', scope: scope as SyncOptions['scope'] })) { /* CLI 是唯一生成实现 */ }
  const after = await fs.readdir(outDir);
  const ext = tool === 'cursor' ? '.mdc' : '.md';
  return {
    count: after.filter((file) => file.endsWith(ext) && file !== `00-context${ext}`).length,
    backedUp: after.filter((file) => file.endsWith('.bak') && !before.has(file)),
  };
}
