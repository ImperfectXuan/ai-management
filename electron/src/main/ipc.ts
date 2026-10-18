// electron/src/main/ipc.ts
import { ipcMain, app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import { ContentLibraryStore } from '../core/content-library';
import { WorkspaceStore, type Repo } from '../core/workspace';
import { WorkspaceError } from '../core/errors';
import { IPC } from '../shared/ipc';
import * as rulesApi from '../core/rules';
import * as mcpApi from '../core/mcp';
import * as skillsApi from '../core/skills';
import { isFullSyncCompletion, type SyncOptions } from '../core/sync';
import { compareRuleToGenerated } from '../core/diff';
import { runAiwsJson } from '../core/vault-bridge';
import { loadConfig, getToolSkillsPath, SUPPORTED_TOOLS } from '../core/config';
import { createSyncService } from '../core/sync-service';
import { SyncStatusStore, getSyncStatusPaths } from '../core/sync-status-store';
import type { SyncModule, SyncTool } from '../shared/sync-status';
import { validateRulesSetRequiredArgs } from './rules-args';
import { registerIntakeIpc } from './intake-ipc';

const runtimeScripts = app.isPackaged
  ? path.join(process.resourcesPath, 'aiws-scripts')
  : path.join(app.getAppPath(), '..', '.ai-workspace/scripts');
export const libraryStore = new ContentLibraryStore(path.join(app.getPath('userData'), 'content-library.json'), runtimeScripts);
export const runtimeCli = path.join(runtimeScripts, 'aiws');

export const store = new WorkspaceStore(path.join(app.getPath('userData'), 'repos.json'));

// 统一同步状态与执行服务（design §6）：全部写入入口共用，状态不写入 WorkspaceStore。
const statusPaths = getSyncStatusPaths(app.getPath('userData'));
export const syncStatusStore = new SyncStatusStore(statusPaths.statusFile);
export const syncService = createSyncService({
  store: syncStatusStore,
  keyFile: statusPaths.keyFile,
  reportDir: path.join(app.getPath('userData'), 'sync-reports'),
});

/** 启动恢复：残留 running 改为 interrupted（design §5）；在窗口创建前执行。 */
export async function recoverSyncStatusOnStartup(): Promise<number> {
  return syncStatusStore.recoverInterrupted(new Date().toISOString());
}

type Handler<TArgs, TResult> = (args: TArgs) => Promise<TResult>;

function handle<TArgs, TResult>(channel: string, fn: Handler<TArgs, TResult>) {
  ipcMain.handle(channel, async (_event, args: TArgs) => {
    try {
      const data = await fn(args);
      return { ok: true, data };
    } catch (err) {
      if (err instanceof WorkspaceError) {
        return { ok: false, code: err.code, message: err.message };
      }
      console.error(`[ipc:${channel}]`, err);
      return { ok: false, code: 'InternalError', message: err instanceof Error ? err.message : String(err) };
    }
  });
}

interface SyncState {
  controller: AbortController;
}
const syncStates = new Map<string, SyncState>();

function broadcast(channel: string, payload: unknown) {
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(channel, payload));
}

/**
 * 单仓库同步的唯一执行路径（design §6）：SyncRun、SyncAll、托盘全部经 service.runBatch。
 * 失败单元抛 SyncFailed（保留错误反馈）；仅全量成功才更新旧 lastSyncAt 兼容时间。
 */
async function executeRepoSync(
  repo: Repo,
  opts: { signal: AbortSignal; tool?: string; only?: string; scope?: 'global' | 'project' },
): Promise<void> {
  const libraryRoot = await libraryStore.get();
  const scope = opts.scope ?? 'project';
  const configured = opts.tool
    ? [opts.tool]
    : (await loadConfig(path.join(libraryRoot, '.ai-workspace'))).tools.filter((tool) =>
        (SUPPORTED_TOOLS as readonly string[]).includes(tool));
  const tools = configured as SyncTool[];
  const modules: SyncModule[] = opts.only ? [opts.only as SyncModule] : ['rules', 'mcp', 'skills'];

  const batch = await syncService.runBatch({
    libraryRoot,
    projectRoot: repo.path,
    tools,
    modules,
    scope,
    cliPath: runtimeCli,
    signal: opts.signal,
    onProgress: (line, unit, operationId) => broadcast(IPC.SyncProgress, { repoId: repo.id, line, unit, operationId }),
    onUnitDone: (result) => broadcast(IPC.SyncStatusChanged, { libraryRoot, changedBy: 'sync', unit: result.unit, outcome: result.outcome }),
  });

  const failed = batch.results.find((result) => result.outcome !== 'applied' && result.outcome !== 'skipped');
  if (failed) {
    throw new WorkspaceError(
      'SyncFailed',
      `同步未完成：${failed.unit.tool}/${failed.unit.module}（${failed.reasonCode ?? failed.outcome}）`,
    );
  }
  // 成功时间兼容：仅全量执行（未按工具/模块收窄且 project）才更新旧 lastSyncAt
  if (isFullSyncCompletion(opts) && batch.results.some((result) => result.outcome === 'applied')) {
    await store.update({ ...repo, lastSyncAt: new Date().toISOString() });
  }
}

/** 全量同步全部仓库（SyncAll 与托盘共用）；仓库正在同步时显式报错。 */
export async function runFullSyncAll(): Promise<{ done: number }> {
  const repos = await store.load();
  let done = 0;
  for (const repo of repos) {
    if (syncStates.has(repo.id)) throw new WorkspaceError('SyncFailed', `仓库正在同步，请稍后重试：${repo.name}`);
    const controller = new AbortController();
    syncStates.set(repo.id, { controller });
    try {
      await executeRepoSync(repo, { signal: controller.signal });
      broadcast(IPC.SyncDone, { repoId: repo.id });
      done += 1;
    } finally {
      syncStates.delete(repo.id);
    }
  }
  return { done };
}

/** 单项 Skill 链接/卸载的唯一写入路径：经 service 门控，不更新模块 lastSuccess。 */
async function runSingleSkillOp(
  libraryRoot: string,
  targetRoot: string,
  args: { scope: 'global' | 'project'; tool?: string; skillName?: string },
  action: 'link' | 'unlink',
): Promise<{ count: number }> {
  const cfg = await loadConfig(path.join(libraryRoot, '.ai-workspace'));
  const wanted = args.tool ? [args.tool] : cfg.tools;
  const units = wanted
    .filter((tool): tool is SyncTool => (SUPPORTED_TOOLS as readonly string[]).includes(tool))
    .map((tool) => ({ tool, targetBase: getToolSkillsPath(targetRoot, tool, args.scope) }))
    .filter((unit): unit is { tool: SyncTool; targetBase: string } => Boolean(unit.targetBase));
  if (units.length === 0) return { count: 0 };

  const result = await syncService.runSingleSkillWrite({
    libraryRoot,
    projectRoot: targetRoot,
    scope: args.scope,
    units,
    action,
    write: () => (action === 'link'
      ? skillsApi.linkSkills(libraryRoot, args.scope, args.tool, args.skillName, targetRoot)
      : skillsApi.unlinkSkills(libraryRoot, args.scope, args.tool, args.skillName, targetRoot)),
  });
  broadcast(IPC.SyncStatusChanged, { libraryRoot, changedBy: action, scope: args.scope });
  return result;
}

export function registerIpc() {
  handle(IPC.LibraryGet, () => libraryStore.load());
  handle(IPC.LibrarySelect, async (args: { path: string; initialize: boolean }) => {
    if (!args || typeof args.path !== 'string' || typeof args.initialize !== 'boolean') {
      throw new WorkspaceError('InvalidArgument', '请选择内容库路径与接入方式');
    }
    if (syncStates.size) throw new WorkspaceError('SyncFailed', '同步过程中不能切换内容库');
    return libraryStore.select(args.path, args.initialize);
  });
  handle(IPC.DirectoryChoose, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  handle(IPC.WorkspaceList, () => store.load());
  handle(IPC.WorkspaceAdd, (dir: string) => store.add(dir));
  handle(IPC.WorkspaceRemove, (id: string) => store.remove(id));

  handle(IPC.RulesList, async () => rulesApi.listRules(await libraryStore.get()));
  handle(IPC.RulesSetRequired, async (raw: unknown) => {
    const args = validateRulesSetRequiredArgs(raw);
    const libraryRoot = await libraryStore.get();
    await rulesApi.setRuleRequired(libraryRoot, args.tool, args.id, args.domain, args.value);
    // 来源修改只发重查提示；实际版本状态由查询按真实文件重算（design §6）
    broadcast(IPC.SyncStatusChanged, { libraryRoot, changedBy: 'rules' });
  });

  handle(IPC.McpList, async () => mcpApi.listMcp(await libraryStore.get()));
  handle(IPC.McpAdd, async (args: { repoId: string; name: string; command: string; args?: string[] }) => {
    const libraryRoot = await libraryStore.get();
    await mcpApi.addMcp(libraryRoot, args.name, args.command, args.args);
    broadcast(IPC.SyncStatusChanged, { libraryRoot, changedBy: 'mcp' });
  });
  handle(IPC.McpRemove, async (args: { repoId: string; name: string }) => {
    const libraryRoot = await libraryStore.get();
    await mcpApi.removeMcp(libraryRoot, args.name);
    broadcast(IPC.SyncStatusChanged, { libraryRoot, changedBy: 'mcp' });
  });

  handle(IPC.SkillsList, async (repoId: string) => {
    const target = repoId && repoId !== 'content-library' ? (await store.get(repoId)).path : null;
    return skillsApi.listSkills(await libraryStore.get(), target);
  });
  handle(IPC.SkillsLink, async (args: { repoId: string; scope: 'global' | 'project'; tool?: string; skillName?: string }) => {
    const repo = await store.get(args.repoId);
    return runSingleSkillOp(await libraryStore.get(), repo.path, args, 'link');
  });
  handle(IPC.SkillsUnlink, async (args: { repoId: string; scope: 'global' | 'project'; tool?: string; skillName?: string }) => {
    const repo = await store.get(args.repoId);
    return runSingleSkillOp(await libraryStore.get(), repo.path, args, 'unlink');
  });

  handle(IPC.SecretsList, async (repoId: string) => {
    return runAiwsJson(await libraryStore.get(), ['secrets', 'list', '--json']);
  });
  handle(IPC.SecretsAudit, async (repoId: string) => {
    return runAiwsJson(await libraryStore.get(), ['secrets', 'audit', '--json']);
  });

  handle(IPC.SyncRun, async (args: { repoId: string } & SyncOptions) => {
    const repo = await store.get(args.repoId);
    if (syncStates.has(repo.id)) throw new WorkspaceError('SyncFailed', '该仓库正在同步，请等待完成或取消');
    const controller = new AbortController();
    syncStates.set(repo.id, { controller });
    try {
      await executeRepoSync(repo, {
        signal: controller.signal,
        tool: args.tool,
        only: args.only,
        scope: args.scope,
      });
      broadcast(IPC.SyncDone, { repoId: repo.id });
      return { synced: true };
    } finally {
      syncStates.delete(repo.id);
    }
  });
  handle(IPC.SyncCancel, async (repoId: string) => {
    const state = syncStates.get(repoId);
    if (state) state.controller.abort();
  });

  handle(IPC.SyncAll, async () => {
    await runFullSyncAll();
    return { ok: true };
  });

  handle(IPC.DiffCompare, async (args: { repoId: string; tool: 'cursor' | 'trae'; ruleId: string }) => {
    const repo = await store.get(args.repoId);
    return compareRuleToGenerated(repo.path, args.tool, args.ruleId, await libraryStore.get(), runtimeCli);
  });

  registerIntakeIpc({ handle }, broadcast, () => libraryStore.get());
}
