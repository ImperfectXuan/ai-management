// electron/src/main/ipc.ts
import { ipcMain, app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import { ContentLibraryStore } from '../core/content-library';
import { WorkspaceStore } from '../core/workspace';
import { WorkspaceError } from '../core/errors';
import { IPC } from '../shared/ipc';
import * as rulesApi from '../core/rules';
import * as mcpApi from '../core/mcp';
import * as skillsApi from '../core/skills';
import { syncRun, type SyncOptions } from '../core/sync';
import { compareRuleToGenerated } from '../core/diff';
import { runAiwsJson } from '../core/vault-bridge';
import { validateRulesSetRequiredArgs } from './rules-args';
import { registerIntakeIpc } from './intake-ipc';

const runtimeScripts = app.isPackaged
  ? path.join(process.resourcesPath, 'aiws-scripts')
  : path.join(app.getAppPath(), '..', '.ai-workspace/scripts');
export const libraryStore = new ContentLibraryStore(path.join(app.getPath('userData'), 'content-library.json'), runtimeScripts);
export const runtimeCli = path.join(runtimeScripts, 'aiws');

export const store = new WorkspaceStore(path.join(app.getPath('userData'), 'repos.json'));

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
    await rulesApi.setRuleRequired(await libraryStore.get(), args.tool, args.id, args.domain, args.value);
  });

  handle(IPC.McpList, async () => mcpApi.listMcp(await libraryStore.get()));
  handle(IPC.McpAdd, async (args: { repoId: string; name: string; command: string; args?: string[] }) => {
    await mcpApi.addMcp(await libraryStore.get(), args.name, args.command, args.args);
  });
  handle(IPC.McpRemove, async (args: { repoId: string; name: string }) => {
    await mcpApi.removeMcp(await libraryStore.get(), args.name);
  });

  handle(IPC.SkillsList, async (repoId: string) => {
    const target = repoId && repoId !== 'content-library' ? (await store.get(repoId)).path : null;
    return skillsApi.listSkills(await libraryStore.get(), target);
  });
  handle(IPC.SkillsLink, async (args: { repoId: string; scope: 'global' | 'project'; tool?: string; skillName?: string }) => {
    const repo = await store.get(args.repoId);
    return skillsApi.linkSkills(await libraryStore.get(), args.scope, args.tool, args.skillName, repo.path);
  });
  handle(IPC.SkillsUnlink, async (args: { repoId: string; scope: 'global' | 'project'; tool?: string; skillName?: string }) => {
    const repo = await store.get(args.repoId);
    return skillsApi.unlinkSkills(await libraryStore.get(), args.scope, args.tool, args.skillName, repo.path);
  });

  handle(IPC.SecretsList, async (repoId: string) => {
    return runAiwsJson(await libraryStore.get(), ['secrets', 'list', '--json']);
  });
  handle(IPC.SecretsAudit, async (repoId: string) => {
    return runAiwsJson(await libraryStore.get(), ['secrets', 'audit', '--json']);
  });

  handle(IPC.SyncRun, async (args: { repoId: string } & SyncOptions) => {
    const repo = await store.get(args.repoId);
    const libraryRoot = await libraryStore.get();
    if (syncStates.has(repo.id)) throw new WorkspaceError('SyncFailed', '该仓库正在同步，请等待完成或取消');
    const controller = new AbortController();
    syncStates.set(repo.id, { controller });
    try {
      for await (const line of syncRun(repo.path, { tool: args.tool, scope: args.scope, only: args.only, libraryRoot, cliPath: runtimeCli }, controller.signal)) {
        broadcast(IPC.SyncProgress, { repoId: repo.id, line });
      }
      await store.update({ ...repo, lastSyncAt: new Date().toISOString() });
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
    const libraryRoot = await libraryStore.get();
    const repos = await store.load();
    for (const repo of repos) {
      if (syncStates.has(repo.id)) throw new WorkspaceError('SyncFailed', '仓库正在同步，请稍后重试');
      const controller = new AbortController();
      syncStates.set(repo.id, { controller });
      try {
        for await (const line of syncRun(repo.path, { libraryRoot, cliPath: runtimeCli }, controller.signal)) {
          broadcast(IPC.SyncProgress, { repoId: repo.id, line });
        }
        await store.update({ ...repo, lastSyncAt: new Date().toISOString() });
        broadcast(IPC.SyncDone, { repoId: repo.id });
      } finally {
        syncStates.delete(repo.id);
      }
    }
    return { ok: true };
  });

  handle(IPC.DiffCompare, async (args: { repoId: string; tool: 'cursor' | 'trae'; ruleId: string }) => {
    const repo = await store.get(args.repoId);
    return compareRuleToGenerated(repo.path, args.tool, args.ruleId, await libraryStore.get(), runtimeCli);
  });

  registerIntakeIpc({ handle }, broadcast, () => libraryStore.get());
}
