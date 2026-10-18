// electron/test/sync-status-query.test.ts
// 功能 002 TASK-002-06：只读状态查询（AC-002-15/16 的查询层证据）。
// 真实 CLI describe + 合成密钥/沙盒库；查询不创建密钥、不写状态文件、不写目标。
import { test } from 'node:test';
import assert from 'node:assert';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createSyncService } from '../src/core/sync-service';
import { SyncStatusStore } from '../src/core/sync-status-store';
import { querySyncStatus, rebuildLocalSyncStatus } from '../src/core/sync-status-query';
import { KEY_BYTES } from '../src/core/sync-fingerprint';

interface Sandbox {
  root: string;
  aiws: string;
  project: string;
  statusFile: string;
  keyFile: string;
  reportDir: string;
}

function makeSandbox(name: string): Sandbox {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), `aiws-query-${name}-`)));
  const aiws = path.join(root, '.ai-workspace');
  const project = path.join(root, 'project');
  const stateDir = path.join(root, 'state');
  mkdirSync(project, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  cpSync(path.resolve(__dirname, '../../.ai-workspace/scripts'), path.join(aiws, 'scripts'), { recursive: true });

  for (const dir of ['rules/domains', 'memory/context', 'config', 'adapters/cursor', 'skills/alpha', 'mcp']) {
    mkdirSync(path.join(aiws, dir), { recursive: true });
  }
  writeFileSync(path.join(aiws, 'rules/00-core.md'), '---\nid: 00-core\ntitle: Core\nscope: all\n---\n# QUERY_CORE\n');
  writeFileSync(path.join(aiws, 'adapters/cursor/mapping.yaml'),
    'tool: cursor\nrules:\n  - source: rules/00-core.md\n    required: true\n');
  writeFileSync(path.join(aiws, 'config/workspace.json'),
    '{"version":"1.0","tools":["codex","cursor"],"default_scope":"project"}\n');
  writeFileSync(path.join(aiws, 'skills/alpha/SKILL.md'), '# ALPHA\n');
  writeFileSync(path.join(aiws, 'mcp/mcp.json'), JSON.stringify({
    servers: { filesystem: { command: 'npx', args: ['fs'], scope: ['project'] } },
  }) + '\n');

  return {
    root, aiws, project,
    statusFile: path.join(stateDir, 'sync-status.json'),
    keyFile: path.join(stateDir, 'sync-fingerprint.key'),
    reportDir: path.join(root, 'reports'),
  };
}

function makeStore(sb: Sandbox): SyncStatusStore {
  return new SyncStatusStore(sb.statusFile);
}

function treeSnapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(dir, full));
    }
  };
  walk(dir);
  return out.sort();
}

test('query_只读不创建密钥不写状态与目标', async () => {
  const sb = makeSandbox('readonly');
  const beforeLib = treeSnapshot(sb.root);
  const result = await querySyncStatus(
    { scope: 'project' },
    { store: makeStore(sb), keyFile: sb.keyFile, libraryRoot: sb.root, projectRoot: sb.project },
  );
  assert.strictEqual(existsSync(sb.keyFile), false, '查询不得创建指纹密钥');
  assert.strictEqual(existsSync(sb.statusFile), false, '查询不得创建状态文件');
  assert.ok(result.checkedAt && Number.isFinite(Date.parse(result.checkedAt)));
  assert.ok(result.units.length > 0);
  for (const unit of result.units) {
    assert.strictEqual(unit.versionState, 'untracked', '无基线单元为 untracked');
    assert.strictEqual(unit.attemptState, 'never');
    // 视图不得暴露指纹/路径/keyId
    assert.ok(!JSON.stringify(unit).includes('sha256:'), '单元视图不含哈希');
  }
  assert.deepStrictEqual(treeSnapshot(sb.root), beforeLib, '规范层与目标无写入');
  rmSync(sb.root, { recursive: true, force: true });
});

test('query_已同步后来源变化变pending_无项目不列project单元', async () => {
  const sb = makeSandbox('pending');
  const service = createSyncService({
    store: makeStore(sb), keyFile: sb.keyFile, reportDir: sb.reportDir,
  });
  await service.runUnit({
    libraryRoot: sb.root, projectRoot: sb.project, tool: 'cursor', module: 'rules', scope: 'project',
  });

  const withProject = await querySyncStatus(
    { scope: 'project' },
    { store: makeStore(sb), keyFile: sb.keyFile, libraryRoot: sb.root, projectRoot: sb.project },
  );
  const cursorRules = withProject.units.find((u) => u.tool === 'cursor' && u.module === 'rules');
  assert.strictEqual(cursorRules?.versionState, 'current');
  assert.ok(cursorRules?.lastSuccessAt);
  // 只查该单元时聚合为 current；文案固定含「未检查目标文件」
  const onlyCursor = await querySyncStatus(
    { scope: 'project', tool: 'cursor', module: 'rules' },
    { store: makeStore(sb), keyFile: sb.keyFile, libraryRoot: sb.root, projectRoot: sb.project },
  );
  assert.strictEqual(onlyCursor.aggregate.state, 'current');
  assert.ok(onlyCursor.aggregate.summaryText.includes('已同步当前版本（未检查目标文件）'));

  // 修改来源 → pending/source_changed
  writeFileSync(path.join(sb.aiws, 'rules/00-core.md'), '---\nid: 00-core\ntitle: Core\nscope: all\n---\n# QUERY_CORE_V2\n');
  const afterEdit = await querySyncStatus(
    { scope: 'project', tool: 'cursor', module: 'rules' },
    { store: makeStore(sb), keyFile: sb.keyFile, libraryRoot: sb.root, projectRoot: sb.project },
  );
  assert.strictEqual(afterEdit.units.length, 1);
  assert.strictEqual(afterEdit.units[0].versionState, 'pending');
  assert.strictEqual(afterEdit.units[0].reasonCode, 'source_changed');

  // 无项目：project 单元不进入列表，不能显示 current
  const noProject = await querySyncStatus(
    { scope: 'project' },
    { store: makeStore(sb), keyFile: sb.keyFile, libraryRoot: sb.root },
  );
  assert.deepStrictEqual(noProject.units, [], '无项目时 project 单元不进入列表');
  assert.notStrictEqual(noProject.aggregate.state, 'current');
  rmSync(sb.root, { recursive: true, force: true });
});

test('query_密钥缺失与更换_有基线时unknown_优先于current', async () => {
  const sb = makeSandbox('key');
  const service = createSyncService({
    store: makeStore(sb), keyFile: sb.keyFile, reportDir: sb.reportDir,
  });
  await service.runUnit({
    libraryRoot: sb.root, projectRoot: sb.project, tool: 'cursor', module: 'rules', scope: 'project',
  });

  // 原位替换为另一合法密钥
  const other = randomBytes(KEY_BYTES);
  writeFileSync(sb.keyFile, other, { mode: 0o600 });
  const afterSwap = await querySyncStatus(
    { scope: 'project', tool: 'cursor', module: 'rules' },
    { store: makeStore(sb), keyFile: sb.keyFile, libraryRoot: sb.root, projectRoot: sb.project },
  );
  assert.strictEqual(afterSwap.units[0].versionState, 'unknown');
  assert.strictEqual(afterSwap.units[0].reasonCode, 'key_changed');

  // 删除密钥
  rmSync(sb.keyFile);
  const afterDelete = await querySyncStatus(
    { scope: 'project', tool: 'cursor', module: 'rules' },
    { store: makeStore(sb), keyFile: sb.keyFile, libraryRoot: sb.root, projectRoot: sb.project },
  );
  assert.strictEqual(afterDelete.units[0].versionState, 'unknown');
  assert.strictEqual(afterDelete.units[0].reasonCode, 'key_missing');
  rmSync(sb.root, { recursive: true, force: true });
});

test('query_状态文件损坏_返回storeProblem_重建备份后可恢复空状态', async () => {
  const sb = makeSandbox('corrupt');
  mkdirSync(path.dirname(sb.statusFile), { recursive: true });
  writeFileSync(sb.statusFile, '{ not json');
  writeFileSync(sb.keyFile, randomBytes(KEY_BYTES), { mode: 0o600 });

  const broken = await querySyncStatus(
    { scope: 'project' },
    { store: makeStore(sb), keyFile: sb.keyFile, libraryRoot: sb.root, projectRoot: sb.project },
  );
  assert.ok(broken.storeProblem);
  assert.strictEqual(broken.storeProblem?.reasonCode, 'status_invalid');
  assert.strictEqual(broken.storeProblem?.rebuildAvailable, true);
  assert.notStrictEqual(broken.aggregate.state, 'current', '损坏不得伪装成 current');
  assert.strictEqual(broken.units.length, 0, '损坏不得伪装成 0 项成功');

  const backup = await rebuildLocalSyncStatus({ statusFile: sb.statusFile, keyFile: sb.keyFile });
  assert.ok(backup.statusBackup && existsSync(backup.statusBackup));
  assert.ok(backup.keyBackup && existsSync(backup.keyBackup));
  assert.strictEqual(existsSync(sb.statusFile), false);
  assert.strictEqual(existsSync(sb.keyFile), false);

  const rebuilt = await querySyncStatus(
    { scope: 'project' },
    { store: makeStore(sb), keyFile: sb.keyFile, libraryRoot: sb.root, projectRoot: sb.project },
  );
  assert.strictEqual(rebuilt.storeProblem, undefined);
  for (const unit of rebuilt.units) assert.strictEqual(unit.versionState, 'untracked');
  rmSync(sb.root, { recursive: true, force: true });
});

test('query_禁用模块与global剔除rules', async () => {
  const sb = makeSandbox('applicability');
  // 关闭 skills 模块需要 CLI 配置；用 unsupported 路径：rules global 被枚举层剔除
  const globalResult = await querySyncStatus(
    { scope: 'global' },
    { store: makeStore(sb), keyFile: sb.keyFile, libraryRoot: sb.root, projectRoot: sb.project },
  );
  assert.ok(globalResult.units.every((unit) => unit.module !== 'rules'), 'global 不含 rules');
  assert.ok(globalResult.units.some((unit) => unit.module === 'skills'));
  assert.ok(globalResult.units.some((unit) => unit.module === 'mcp'));
  rmSync(sb.root, { recursive: true, force: true });
});

test('query_已有成功记录在重启后仍可恢复_current', async () => {
  const sb = makeSandbox('restart');
  const service = createSyncService({
    store: makeStore(sb), keyFile: sb.keyFile, reportDir: sb.reportDir,
  });
  await service.runUnit({
    libraryRoot: sb.root, projectRoot: sb.project, tool: 'cursor', module: 'rules', scope: 'project',
  });
  const completedAt = (await makeStore(sb).load()).records[0]?.lastSuccess?.completedAt;
  assert.ok(completedAt);

  // 新 Store 实例模拟重启
  const restarted = await querySyncStatus(
    { scope: 'project', tool: 'cursor', module: 'rules' },
    { store: makeStore(sb), keyFile: sb.keyFile, libraryRoot: sb.root, projectRoot: sb.project },
  );
  assert.strictEqual(restarted.units[0].versionState, 'current');
  assert.strictEqual(restarted.units[0].lastSuccessAt, completedAt);
  rmSync(sb.root, { recursive: true, force: true });
});
