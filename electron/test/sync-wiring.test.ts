// electron/test/sync-wiring.test.ts
// 功能 002 TASK-002-05：写入入口接线守护（完成条件「没有绕过 service 的写入路径」）。
// 以源码断言锁定结构约束：主进程不再直接调用 CLI 同步，单项 Skill 写入经 service 门控，
// lastSyncAt 仅在全量成功路径更新，单实例与启动恢复已接线。
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isFullSyncCompletion } from '../src/core/sync';

function readSource(rel: string): string {
  return readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
}

test('主进程全部同步经sync-service_无直接CLI同步调用', () => {
  const ipcSrc = readSource('src/main/ipc.ts');
  const traySrc = readSource('src/main/tray.ts');

  assert.ok(!/syncRun\s*\(/.test(ipcSrc), 'ipc.ts 不得直接调用 syncRun');
  assert.ok(!/syncRun/.test(traySrc), 'tray.ts 不得引用 syncRun');
  assert.ok(ipcSrc.includes('syncService.runBatch'), 'SyncRun/SyncAll 经 service.runBatch');
  assert.ok(traySrc.includes('runFullSyncAll'), '托盘经共享 runFullSyncAll 路径');
});

test('单项Skill写入经service门控_链接层仅出现在write回调', () => {
  const ipcSrc = readSource('src/main/ipc.ts');
  assert.ok(ipcSrc.includes('runSingleSkillOp'), 'SkillsLink/Unlink 走统一单项路径');
  assert.ok(ipcSrc.includes('runSingleSkillWrite'), '单项路径进入 service 门控');
  const linkCalls = ipcSrc.match(/skillsApi\.linkSkills\(/g) ?? [];
  const unlinkCalls = ipcSrc.match(/skillsApi\.unlinkSkills\(/g) ?? [];
  assert.strictEqual(linkCalls.length, 1, 'linkSkills 仅在 service 的 write 回调内出现一次');
  assert.strictEqual(unlinkCalls.length, 1, 'unlinkSkills 仅在 service 的 write 回调内出现一次');
});

test('lastSyncAt仅在全量成功路径更新_托盘不再单独写入', () => {
  const ipcSrc = readSource('src/main/ipc.ts');
  const traySrc = readSource('src/main/tray.ts');
  const writes = ipcSrc.match(/lastSyncAt:/g) ?? [];
  assert.strictEqual(writes.length, 1, 'ipc.ts 仅保留唯一一处 lastSyncAt 写入（全量成功分支）');
  assert.ok(ipcSrc.includes('isFullSyncCompletion(opts)'), '该写入受全量判定保护');
  assert.ok(!/lastSyncAt/.test(traySrc), '托盘不再写 lastSyncAt');
});

test('单实例约束与启动恢复已接线', () => {
  const indexSrc = readSource('src/main/index.ts');
  assert.ok(indexSrc.includes('requestSingleInstanceLock'), '启用单实例锁');
  assert.ok(indexSrc.includes('recoverSyncStatusOnStartup'), '启动时恢复残留 running');
  assert.ok(indexSrc.includes('app.quit()'), '未获锁时退出');
});

test('来源修改与收编回退发出SyncStatusChanged提示', () => {
  const ipcSrc = readSource('src/main/ipc.ts');
  const intakeSrc = readSource('src/main/intake-ipc.ts');
  assert.ok(/changedBy: 'rules'/.test(ipcSrc), '规则修改发提示');
  assert.ok(/changedBy: 'mcp'/.test(ipcSrc), 'MCP 修改发提示');
  assert.ok(/changedBy: 'intake_apply'/.test(intakeSrc), '收编入库发提示');
  assert.ok(/changedBy: 'intake_rollback'/.test(intakeSrc), '回退发提示');
});

test('isFullSyncCompletion_仅未收窄的project执行算全量完成', () => {
  assert.strictEqual(isFullSyncCompletion({}), true);
  assert.strictEqual(isFullSyncCompletion({ scope: 'project' }), true);
  assert.strictEqual(isFullSyncCompletion({ only: 'rules' }), false, '单模块不算全量');
  assert.strictEqual(isFullSyncCompletion({ tool: 'codex' }), false, '单工具不算全量');
  assert.strictEqual(isFullSyncCompletion({ scope: 'global' }), false, 'global 不算项目全量');
  assert.strictEqual(isFullSyncCompletion({ tool: 'codex', only: 'rules', scope: 'project' }), false);
});
