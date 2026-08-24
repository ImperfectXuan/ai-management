// electron/src/main/ipc.ts
import { ipcMain, app, BrowserWindow } from 'electron';
import path from 'node:path';
import { WorkspaceStore } from '../core/workspace';
import { WorkspaceError } from '../core/errors';
import { IPC } from '../shared/ipc';
import * as rulesApi from '../core/rules';
import * as mcpApi from '../core/mcp';
import * as skillsApi from '../core/skills';
import { syncRun } from '../core/sync';
import { compareRuleToGenerated } from '../core/diff';
import { runAiwsBridge } from '../core/vault-bridge';
import { validateRulesSetRequiredArgs } from './rules-args';

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
  handle(IPC.WorkspaceList, () => store.load());
  handle(IPC.WorkspaceAdd, (dir: string) => store.add(dir));
  handle(IPC.WorkspaceRemove, (id: string) => store.remove(id));

  handle(IPC.RulesList, async (repoId: string) => {
    const repo = await store.get(repoId);
    return rulesApi.listRules(repo.path);
  });
  handle(IPC.RulesSetRequired, async (raw: unknown) => {
    const args = validateRulesSetRequiredArgs(raw);
    const repo = await store.get(args.repoId);
    await rulesApi.setRuleRequired(repo.path, args.tool, args.id, args.domain, args.value);
  });

  handle(IPC.McpList, async (repoId: string) => {
    const repo = await store.get(repoId);
    return mcpApi.listMcp(repo.path);
  });
  handle(IPC.McpAdd, async (args: { repoId: string; name: string; command: string; args?: string[] }) => {
    const repo = await store.get(args.repoId);
    await mcpApi.addMcp(repo.path, args.name, args.command, args.args);
  });
  handle(IPC.McpRemove, async (args: { repoId: string; name: string }) => {
    const repo = await store.get(args.repoId);
    await mcpApi.removeMcp(repo.path, args.name);
  });

  handle(IPC.SkillsList, async (repoId: string) => {
    const repo = await store.get(repoId);
    return skillsApi.listSkills(repo.path);
  });
  handle(IPC.SkillsLink, async (args: { repoId: string; scope: 'global' | 'project'; tool?: string }) => {
    const repo = await store.get(args.repoId);
    return skillsApi.linkSkills(repo.path, args.scope, args.tool);
  });
  handle(IPC.SkillsUnlink, async (args: { repoId: string; scope: 'global' | 'project'; tool?: string }) => {
    const repo = await store.get(args.repoId);
    return skillsApi.unlinkSkills(repo.path, args.scope, args.tool);
  });

  handle(IPC.SecretsList, async (repoId: string) => {
    const repo = await store.get(repoId);
    const res = await runAiwsBridge(repo.path, ['secrets', 'list', '--json']);
    return safeParse(res.stdout);
  });
  handle(IPC.SecretsAudit, async (repoId: string) => {
    const repo = await store.get(repoId);
    const res = await runAiwsBridge(repo.path, ['secrets', 'audit', '--json']);
    return safeParse(res.stdout);
  });

  handle(IPC.SyncRun, async (args: { repoId: string; tool?: string }) => {
    const repo = await store.get(args.repoId);
    const controller = new AbortController();
    syncStates.set(repo.id, { controller });
    try {
      for await (const line of syncRun(repo.path, { tool: args.tool }, controller.signal)) {
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
    const repos = await store.load();
    for (const repo of repos) {
      const controller = new AbortController();
      syncStates.set(repo.id, { controller });
      try {
        for await (const line of syncRun(repo.path, {}, controller.signal)) {
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
    return compareRuleToGenerated(repo.path, args.tool, args.ruleId);
  });
}

function safeParse(text: string): unknown {
  try { return JSON.parse(text); } catch { return { error: text.slice(0, 300) }; }
}
