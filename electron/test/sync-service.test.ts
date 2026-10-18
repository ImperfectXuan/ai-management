// electron/test/sync-service.test.ts
// 功能 002 TASK-002-04：统一执行服务编排（design §4 顺序、§2.3 等价收敛与失效）。
// 全部使用临时库/临时 HOME/合成密钥；错误注入放在进程与文件系统边界（CLI 包装脚本、chmod）。
import { test } from 'node:test';
import assert from 'node:assert';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createSyncService, SyncService, SyncUnitResult } from '../src/core/sync-service';
import { SyncStatusStore } from '../src/core/sync-status-store';
import { resolveVersionState } from '../src/shared/sync-status';
import { SyncModule, SyncScope, SyncTool } from '../src/shared/sync-status';

interface Sandbox {
  root: string;
  aiws: string;
  project: string;
  realCli: string;
  stateDir: string;
  statusFile: string;
  keyFile: string;
  reportDir: string;
}

function makeSandbox(name: string): Sandbox {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), `aiws-service-${name}-`)));
  const aiws = path.join(root, '.ai-workspace');
  const project = path.join(root, 'project');
  const stateDir = path.join(root, 'state');
  mkdirSync(project, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  cpSync(path.resolve(__dirname, '../../.ai-workspace/scripts'), path.join(aiws, 'scripts'), { recursive: true });

  for (const dir of ['rules/domains', 'memory/context', 'config', 'adapters/cursor', 'skills/alpha', 'skills/beta', 'mcp']) {
    mkdirSync(path.join(aiws, dir), { recursive: true });
  }
  writeFileSync(path.join(aiws, 'rules/00-core.md'), '---\nid: 00-core\ntitle: Core\nscope: all\n---\n# SERVICE_CORE\n');
  writeFileSync(path.join(aiws, 'rules/only-cursor.md'), '---\nid: only-cursor\ntitle: C\nscope: all\ntools: [cursor]\n---\n# SERVICE_CURSOR\n');
  writeFileSync(path.join(aiws, 'adapters/cursor/mapping.yaml'),
    'tool: cursor\nrules:\n  - source: rules/00-core.md\n    required: true\n  - source: rules/only-cursor.md\n    required: true\n');
  writeFileSync(path.join(aiws, 'config/workspace.json'),
    '{"version":"1.0","tools":["codex","claude","cursor","trae"],"default_scope":"project"}\n');
  writeFileSync(path.join(aiws, 'skills/alpha/SKILL.md'), '# ALPHA\n');
  writeFileSync(path.join(aiws, 'skills/alpha/helper.sh'), '#!/bin/sh\necho a\n');
  writeFileSync(path.join(aiws, 'skills/beta/SKILL.md'), '# BETA\n');
  writeFileSync(path.join(aiws, 'mcp/mcp.json'), JSON.stringify({
    servers: { filesystem: { command: 'npx', args: ['fs'], scope: ['project'] } },
  }) + '\n');

  const realCli = path.join(aiws, 'scripts/aiws');
  return {
    root, aiws, project, realCli,
    stateDir,
    statusFile: path.join(stateDir, 'sync-status.json'),
    keyFile: path.join(stateDir, 'sync-fingerprint.key'),
    reportDir: path.join(root, 'reports'),
  };
}

function makeService(sb: Sandbox): SyncService {
  return createSyncService({
    store: new SyncStatusStore(sb.statusFile),
    keyFile: sb.keyFile,
    reportDir: sb.reportDir,
  });
}

/** CLI 包装：执行调用（带 --report-file）先 sleep 再透传真实 CLI；describe 不睡。 */
function writeSlowCli(sb: Sandbox, seconds: number): string {
  const file = path.join(sb.root, 'slow-cli.sh');
  writeFileSync(file, `#!/bin/sh
prev=""
report=""
for a in "$@"; do
  if [ "$prev" = "--report-file" ]; then report="$a"; fi
  prev="$a"
done
if [ -n "$report" ]; then sleep ${seconds}; fi
exec "${sb.realCli}" "$@"
`, { mode: 0o755 });
  return file;
}

/** CLI 包装：执行调用直接写 failed 回执并以 0 退出（不真正分发）；describe 透传。 */
function writeFailCli(sb: Sandbox, reasonCode: string): string {
  const file = path.join(sb.root, 'fail-cli.sh');
  writeFileSync(file, `#!/bin/sh
prev=""
report=""
tool=""
module=""
scope=""
for a in "$@"; do
  if [ "$prev" = "--report-file" ]; then report="$a"; fi
  if [ "$prev" = "--tool" ]; then tool="$a"; fi
  if [ "$prev" = "--only" ]; then module="$a"; fi
  if [ "$prev" = "--scope" ]; then scope="$a"; fi
  prev="$a"
done
if [ -n "$report" ]; then
  printf '{"schemaVersion":1,"operationId":"%s","tool":"%s","module":"%s","scope":"%s","outcome":"failed","reasonCode":"%s"}\\n' \\
    "$AIWS_SYNC_OPERATION_ID" "$tool" "$module" "$scope" "${reasonCode}" > "$report"
  exit 0
fi
exec "${sb.realCli}" "$@"
`, { mode: 0o755 });
  return file;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('batch_两工具规则独立成功_两项目记录隔离', async () => {
  const sb = makeSandbox('units');
  const service = makeService(sb);
  const projB = path.join(sb.root, 'project-b');
  mkdirSync(projB);

  const batch = await service.runBatch({
    libraryRoot: sb.root, projectRoot: sb.project,
    tools: ['codex', 'cursor'], modules: ['rules'], scope: 'project',
  });

  assert.strictEqual(batch.stopped, false);
  assert.deepStrictEqual(batch.results.map((r) => r.outcome), ['applied', 'applied']);
  const store = new SyncStatusStore(sb.statusFile);
  const records = await store.list({ targetRoot: sb.project });
  assert.strictEqual(records.length, 2);
  for (const record of records) {
    assert.strictEqual(record.needsResync, false);
    assert.ok(record.lastSuccess?.completedAt, 'applied 单元有成功时间');
  }
  assert.deepStrictEqual(await store.list({ targetRoot: projB }), [], '另一项目无记录');
  rmSync(sb.root, { recursive: true, force: true });
});

test('batch_单元失败即停止_已成单元保留_无关单元不被污染', async () => {
  const sb = makeSandbox('stop');
  const service = makeService(sb);
  const projB = path.join(sb.root, 'project-b');
  mkdirSync(projB);

  // 项目 B 先成功，作为"无关单元"基线
  await service.runUnit({
    libraryRoot: sb.root, projectRoot: projB, tool: 'codex', module: 'rules', scope: 'project',
  });
  const store = new SyncStatusStore(sb.statusFile);
  const beforeB = JSON.stringify(await store.list({ targetRoot: projB }));

  // 项目 A：rules 成功后 mcp 因坏配置在 describe 阶段失败 → 停止，rules 记录保留
  writeFileSync(path.join(sb.aiws, 'mcp/mcp.json'), 'not-json{{{');
  const progress: string[] = [];
  const batch = await service.runBatch({
    libraryRoot: sb.root, projectRoot: sb.project,
    tools: ['codex'], modules: ['rules', 'mcp'], scope: 'project',
    onProgress: (line) => progress.push(line),
  });

  assert.strictEqual(batch.stopped, true);
  assert.strictEqual(batch.results.length, 2);
  assert.strictEqual(batch.results[0].outcome, 'applied');
  assert.strictEqual(batch.results[1].outcome, 'failed');
  assert.strictEqual(batch.results[1].reasonCode, 'describe_failed');

  const recordsA = await store.list({ targetRoot: sb.project, module: 'rules' });
  assert.strictEqual(recordsA.length, 1, '失败前的成功单元记录保留');
  assert.strictEqual(recordsA[0].lastAttempt?.state, 'succeeded');
  assert.strictEqual(JSON.stringify(await store.list({ targetRoot: projB })), beforeB, '无关单元字节不变');
  rmSync(sb.root, { recursive: true, force: true });
});

test('取消_终止CLI进程组_未启动单元不改变', async () => {
  const sb = makeSandbox('cancel');
  const service = makeService(sb);
  const slowCli = writeSlowCli(sb, 3);
  const controller = new AbortController();

  const running = service.runBatch({
    libraryRoot: sb.root, projectRoot: sb.project,
    tools: ['codex', 'claude'], modules: ['rules'], scope: 'project',
    cliPath: slowCli, signal: controller.signal,
  });
  await sleep(1000);
  controller.abort();
  const batch = await running;

  assert.strictEqual(batch.stopped, true);
  assert.strictEqual(batch.results.length, 1, '取消后未启动第二单元');
  assert.strictEqual(batch.results[0].outcome, 'cancelled');

  const store = new SyncStatusStore(sb.statusFile);
  const codex = await store.get({
    libraryRoot: realpathSync(sb.root), targetRoot: realpathSync(sb.project),
    tool: 'codex', module: 'rules', scope: 'project',
  });
  assert.strictEqual(codex?.lastAttempt?.state, 'cancelled');
  assert.strictEqual(codex?.lastSuccess, undefined, '取消不产生成功基线');
  assert.strictEqual(existsSync(path.join(sb.project, 'CLAUDE.md')), false, '未启动单元不写目标');
  assert.strictEqual((await store.list({ tool: 'claude' })).length, 0, '未启动单元无记录');

  // 进程组已终止：包装脚本与 sleep 不再存活
  await sleep(300);
  const survivors = spawnSync('pgrep', ['-f', slowCli], { encoding: 'utf8' });
  assert.strictEqual(survivors.stdout.trim(), '', 'CLI 进程组已终止');
  rmSync(sb.root, { recursive: true, force: true });
});

test('运行期间来源变化_结束指纹不等_阻止提交', async () => {
  const sb = makeSandbox('source-change');
  const service = makeService(sb);
  const slowCli = writeSlowCli(sb, 2);

  const running = service.runUnit({
    libraryRoot: sb.root, projectRoot: sb.project,
    tool: 'codex', module: 'rules', scope: 'project', cliPath: slowCli,
  });
  await sleep(1000);
  writeFileSync(path.join(sb.aiws, 'rules/00-core.md'), '---\nid: 00-core\ntitle: Core\nscope: all\n---\n# MID_RUN_EDIT\n');
  const result = await running;

  assert.strictEqual(result.outcome, 'source_changed');
  assert.strictEqual(result.reasonCode, 'source_changed');
  const store = new SyncStatusStore(sb.statusFile);
  const record = await store.list({ module: 'rules' }).then((all) => all[0]);
  assert.strictEqual(record?.lastAttempt?.state, 'source_changed');
  assert.strictEqual(record?.needsResync, true);
  assert.strictEqual(record?.lastSuccess, undefined, '来源变化不提交成功');
  rmSync(sb.root, { recursive: true, force: true });
});

test('成功提交前记录写失败_显示record_failed_重启恢复为interrupted', async () => {
  const sb = makeSandbox('write-fail');
  const service = makeService(sb);
  const slowCli = writeSlowCli(sb, 2);

  const running = service.runUnit({
    libraryRoot: sb.root, projectRoot: sb.project,
    tool: 'codex', module: 'rules', scope: 'project', cliPath: slowCli,
  });
  await sleep(1000);
  chmodSync(sb.stateDir, 0o555);
  const result = await running;
  chmodSync(sb.stateDir, 0o755);

  assert.strictEqual(result.outcome, 'record_failed');
  assert.strictEqual(result.reasonCode, 'record_unwritable');
  const onDisk = JSON.parse(readFileSync(sb.statusFile, 'utf8'));
  assert.strictEqual(onDisk.records[0].lastAttempt.state, 'running', '磁盘保持 running，重启按 interrupted 处理');

  const restarted = new SyncStatusStore(sb.statusFile);
  assert.strictEqual(await restarted.recoverInterrupted('2026-10-16T08:00:00.000Z'), 1);
  const recovered = await restarted.list({}).then((all) => all[0]);
  assert.strictEqual(recovered?.lastAttempt?.state, 'interrupted');
  assert.strictEqual(recovered?.needsResync, true);
  rmSync(sb.root, { recursive: true, force: true });
});

test('服务进程被强杀_磁盘running_重启恢复为interrupted', async () => {
  const sb = makeSandbox('kill');
  const slowCli = writeSlowCli(sb, 6);
  const childFile = path.join(sb.root, 'crash-service.mts');
  const serviceModule = path.resolve(__dirname, '../src/core/sync-service.ts');
  const storeModule = path.resolve(__dirname, '../src/core/sync-status-store.ts');
  writeFileSync(childFile, `
import { createSyncService } from ${JSON.stringify(serviceModule)};
import { SyncStatusStore } from ${JSON.stringify(storeModule)};
const [statusFile, keyFile, reportDir, root, project, cli] = process.argv.slice(2);
const service = createSyncService({
  store: new SyncStatusStore(statusFile),
  keyFile,
  reportDir,
});
service.runUnit({
  libraryRoot: root, projectRoot: project,
  tool: 'codex', module: 'rules', scope: 'project', cliPath: cli,
}).then(() => process.exit(0), () => process.exit(1));
`);

  const child = spawn(process.execPath, ['--import', 'tsx', childFile,
    sb.statusFile, sb.keyFile, sb.reportDir, sb.root, sb.project, slowCli], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'ignore',
  });
  // 等 beginWrite 落盘 running（describe 很快，CLI sleep 6s 窗口足够）
  let onDisk: { records?: Array<{ lastAttempt?: { state?: string } }> } = {};
  for (let i = 0; i < 60; i += 1) {
    await sleep(100);
    try {
      onDisk = JSON.parse(readFileSync(sb.statusFile, 'utf8'));
    } catch { continue; }
    if (onDisk.records?.[0]?.lastAttempt?.state === 'running') break;
  }
  assert.strictEqual(onDisk.records?.[0]?.lastAttempt?.state, 'running', '子进程已把 running 落盘');

  child.kill('SIGKILL');
  await new Promise((resolve) => child.on('close', resolve));

  const restarted = new SyncStatusStore(sb.statusFile);
  assert.strictEqual(await restarted.recoverInterrupted('2026-10-16T08:30:00.000Z'), 1);
  const record = await restarted.list({}).then((all) => all[0]);
  assert.strictEqual(record?.lastAttempt?.state, 'interrupted');
  assert.strictEqual(record?.needsResync, true);
  assert.strictEqual(record?.lastSuccess, undefined);
  rmSync(sb.root, { recursive: true, force: true });
});

test('同库共享计划_依次成功后双方current_候选保留原完成时间', async () => {
  const sb = makeSandbox('converge');
  const service = makeService(sb);
  const store = new SyncStatusStore(sb.statusFile);
  const keyOf = (tool: SyncTool) => ({
    libraryRoot: realpathSync(sb.root), targetRoot: realpathSync(sb.project),
    tool, module: 'skills' as SyncModule, scope: 'project' as SyncScope,
  });

  const codexFirst = await service.runUnit({
    libraryRoot: sb.root, projectRoot: sb.project, tool: 'codex', module: 'skills', scope: 'project',
  });
  assert.strictEqual(codexFirst.outcome, 'applied');
  const codexOriginalCompletedAt = (await store.get(keyOf('codex')))?.lastSuccess?.completedAt;
  assert.ok(codexOriginalCompletedAt);

  const claudeSecond = await service.runUnit({
    libraryRoot: sb.root, projectRoot: sb.project, tool: 'claude', module: 'skills', scope: 'project',
  });
  assert.strictEqual(claudeSecond.outcome, 'applied');
  assert.strictEqual(claudeSecond.restoredCandidates, 1, '等价候选被原子恢复');

  const codexAfter = await store.get(keyOf('codex'));
  assert.strictEqual(codexAfter?.needsResync, false, 'codex 被恢复为可信状态');
  assert.strictEqual(codexAfter?.lastSuccess?.completedAt, codexOriginalCompletedAt, '恢复保留原完成时间');

  // 重复完整同步：双方仍 current，claude 的原时间在 codex 重跑后保留
  const claudeOriginalCompletedAt = (await store.get(keyOf('claude')))?.lastSuccess?.completedAt;
  const codexAgain = await service.runUnit({
    libraryRoot: sb.root, projectRoot: sb.project, tool: 'codex', module: 'skills', scope: 'project',
  });
  assert.strictEqual(codexAgain.outcome, 'applied');
  const claudeAfter = await store.get(keyOf('claude'));
  assert.strictEqual(claudeAfter?.needsResync, false, '重复同步后 claude 仍为可信状态');
  assert.strictEqual(claudeAfter?.lastSuccess?.completedAt, claudeOriginalCompletedAt);

  for (const tool of ['codex', 'claude'] as SyncTool[]) {
    const record = (await store.get(keyOf(tool)))!;
    const state = resolveVersionState({ record, currentSourceFingerprint: record.lastSuccess!.sourceFingerprint });
    assert.strictEqual(state.state, 'current', `${tool} 显示已同步`);
  }
  assert.strictEqual(existsSync(sb.reportDir) ? readdirSync(sb.reportDir).length : 0, 0, '回执读取后清理');
  rmSync(sb.root, { recursive: true, force: true });
});

test('等价写入失败_重叠codex保持pending且历史保留_显式重试恢复', async () => {
  const sb = makeSandbox('equiv-fail');
  const service = makeService(sb);
  const store = new SyncStatusStore(sb.statusFile);
  const keyOf = (tool: SyncTool) => ({
    libraryRoot: realpathSync(sb.root), targetRoot: realpathSync(sb.project),
    tool, module: 'skills' as SyncModule, scope: 'project' as SyncScope,
  });

  const first = await service.runUnit({
    libraryRoot: sb.root, projectRoot: sb.project, tool: 'codex', module: 'skills', scope: 'project',
  });
  assert.strictEqual(first.outcome, 'applied');
  const originalCompletedAt = (await store.get(keyOf('codex')))?.lastSuccess?.completedAt;

  // claude 执行失败（包装 CLI 写 failed 回执）
  const failCli = writeFailCli(sb, 'cli_failed');
  const failed = await service.runUnit({
    libraryRoot: sb.root, projectRoot: sb.project, tool: 'claude', module: 'skills', scope: 'project',
    cliPath: failCli,
  });
  assert.strictEqual(failed.outcome, 'failed');
  assert.strictEqual(failed.reasonCode, 'cli_failed');

  const codexAfterFail = (await store.get(keyOf('codex')))!;
  assert.strictEqual(codexAfterFail.needsResync, true, '重叠输出在失败写入期间保持失效');
  assert.strictEqual(codexAfterFail.lastSuccess?.completedAt, originalCompletedAt, '历史成功记录保留');
  const codexState = resolveVersionState({
    record: codexAfterFail, currentSourceFingerprint: codexAfterFail.lastSuccess!.sourceFingerprint,
  });
  assert.strictEqual(codexState.state, 'pending', '不显示绿色已同步');
  const claudeRecord = (await store.get(keyOf('claude')))!;
  assert.strictEqual(claudeRecord.lastSuccess, undefined, '不为失败工具伪造成功');

  // 重试 claude 成功：claude 自身记成功；codex 此前已失效 → 按 design「先前已失效的
  // 记录仍失效」不被凭空恢复，需由 codex 自己显式重跑（逐步恢复）。
  const retry = await service.runUnit({
    libraryRoot: sb.root, projectRoot: sb.project, tool: 'claude', module: 'skills', scope: 'project',
  });
  assert.strictEqual(retry.outcome, 'applied');
  assert.strictEqual(retry.restoredCandidates, 0, '先前已失效的候选不被恢复');
  const codexAfterRetry = (await store.get(keyOf('codex')))!;
  assert.strictEqual(codexAfterRetry.needsResync, true, 'codex 仍保持失效直到自己重跑');
  assert.strictEqual(codexAfterRetry.lastSuccess?.completedAt, originalCompletedAt, '历史时间保留');
  const claudeRetryBefore = (await store.get(keyOf('claude')))?.lastSuccess?.completedAt;
  assert.ok(claudeRetryBefore, 'claude 重试后有自己的成功记录');

  const codexRetry = await service.runUnit({
    libraryRoot: sb.root, projectRoot: sb.project, tool: 'codex', module: 'skills', scope: 'project',
  });
  assert.strictEqual(codexRetry.outcome, 'applied');
  const codexRestored = (await store.get(keyOf('codex')))!;
  assert.strictEqual(codexRestored.needsResync, false);
  assert.strictEqual(codexRestored.lastAttempt?.state, 'succeeded');
  // codex 成功时 claude 是可信候选 → 恢复且保留 claude 原时间
  assert.strictEqual(codexRetry.restoredCandidates, 1);
  const claudeFinal = (await store.get(keyOf('claude')))!;
  assert.strictEqual(claudeFinal.needsResync, false);
  assert.strictEqual(claudeFinal.lastSuccess?.completedAt, claudeRetryBefore, '恢复不改 claude 原完成时间');
  rmSync(sb.root, { recursive: true, force: true });
});

test('不可执行单元_跳过且不创建密钥不写状态', async () => {
  const sb = makeSandbox('skip');
  writeFileSync(path.join(sb.aiws, 'config/workspace.json'), JSON.stringify({
    version: '1.0', tools: ['codex', 'claude', 'cursor', 'trae'], default_scope: 'project', skills: { enabled: false },
  }) + '\n');
  const service = makeService(sb);

  const result = await service.runUnit({
    libraryRoot: sb.root, projectRoot: sb.project, tool: 'codex', module: 'skills', scope: 'project',
  });

  assert.strictEqual(result.outcome, 'skipped');
  assert.strictEqual(result.reasonCode, 'module_disabled');
  assert.strictEqual(existsSync(sb.statusFile), false, '不写状态文件');
  assert.strictEqual(existsSync(sb.keyFile), false, '不创建密钥');
  rmSync(sb.root, { recursive: true, force: true });
});

test('密钥长度无效_显式失败且不触碰目标与记录', async () => {
  const sb = makeSandbox('bad-key');
  writeFileSync(sb.keyFile, 'short', { mode: 0o600 });
  const service = makeService(sb);
  const progress: string[] = [];

  const result = await service.runUnit({
    libraryRoot: sb.root, projectRoot: sb.project, tool: 'codex', module: 'rules', scope: 'project',
    onProgress: (line) => progress.push(line),
  });

  assert.strictEqual(result.outcome, 'failed');
  assert.strictEqual(result.reasonCode, 'key_invalid');
  assert.deepStrictEqual(progress, [], '不启动 CLI');
  assert.strictEqual(existsSync(path.join(sb.project, 'AGENTS.md')), false);
  assert.strictEqual(existsSync(sb.statusFile), false);
  rmSync(sb.root, { recursive: true, force: true });
});

test('记录目录不可写_不启动CLI', async () => {
  const sb = makeSandbox('unwritable');
  const service = makeService(sb);
  const progress: string[] = [];
  // 先备好密钥：使失败点落在 beginWrite（记录不可写）而非密钥创建
  writeFileSync(sb.keyFile, randomBytes(32), { mode: 0o600 });

  chmodSync(sb.stateDir, 0o555);
  let result: SyncUnitResult;
  try {
    result = await service.runUnit({
      libraryRoot: sb.root, projectRoot: sb.project, tool: 'codex', module: 'rules', scope: 'project',
      onProgress: (line) => progress.push(line),
    });
  } finally {
    chmodSync(sb.stateDir, 0o755);
  }

  assert.strictEqual(result.outcome, 'failed');
  assert.strictEqual(result.reasonCode, 'record_unwritable');
  assert.deepStrictEqual(progress, [], '记录不可写时不启动 CLI');
  assert.strictEqual(existsSync(path.join(sb.project, 'AGENTS.md')), false);
  rmSync(sb.root, { recursive: true, force: true });
});

test('运行中替换密钥_拒绝提交成功且不恢复候选', async () => {
  const sb = makeSandbox('key-swap');
  const service = makeService(sb);
  const slowCli = writeSlowCli(sb, 2);

  const running = service.runUnit({
    libraryRoot: sb.root, projectRoot: sb.project,
    tool: 'codex', module: 'rules', scope: 'project', cliPath: slowCli,
  });
  await sleep(1000);
  writeFileSync(sb.keyFile, randomBytes(32), { mode: 0o600 });
  const result = await running;

  assert.strictEqual(result.outcome, 'failed');
  assert.strictEqual(result.reasonCode, 'key_changed');
  const store = new SyncStatusStore(sb.statusFile);
  const record = await store.list({ module: 'rules' }).then((all) => all[0]);
  assert.strictEqual(record?.lastAttempt?.state, 'failed');
  assert.strictEqual(record?.lastSuccess, undefined, '换密钥后不提交成功');
  assert.strictEqual(record?.lastAttempt?.keyId !== undefined && record.lastAttempt.keyId.startsWith('sha256:'), true);
  rmSync(sb.root, { recursive: true, force: true });
});

test('并发共享技能输出_锁串行_路径别名目标不重叠执行', async () => {
  const sb = makeSandbox('concurrent');
  const service = makeService(sb);
  const slowCli = writeSlowCli(sb, 1);
  const aliasProject = path.join(sb.root, 'project-alias');
  symlinkSync(sb.project, aliasProject);

  const events: Array<{ tool: string; at: number }> = [];
  let seq = 0;
  const stamp = (tool: string) => events.push({ tool, at: seq++ });

  const [codex, claude] = await Promise.all([
    service.runUnit({
      libraryRoot: sb.root, projectRoot: sb.project,
      tool: 'codex', module: 'skills', scope: 'project', cliPath: slowCli,
      onProgress: () => stamp('codex'),
    }),
    service.runUnit({
      libraryRoot: sb.root, projectRoot: aliasProject,
      tool: 'claude', module: 'skills', scope: 'project', cliPath: slowCli,
      onProgress: () => stamp('claude'),
    }),
  ]);

  assert.strictEqual(codex.outcome, 'applied');
  assert.strictEqual(claude.outcome, 'applied');
  // 输出集合重叠（.agents/skills，别名归并后同键）→ 必须严格串行：
  // 事件流只允许出现一次工具切换（先到者完整执行，后到者整体等待），绝不交错。
  const transitions = events.slice(1).filter((event, index) => event.tool !== events[index].tool).length;
  assert.strictEqual(transitions, 1, `共享输出必须串行执行（events=${JSON.stringify(events.map((e) => e.tool))}）`);

  const store = new SyncStatusStore(sb.statusFile);
  const records = await store.list({ module: 'skills' });
  assert.strictEqual(records.length, 2);
  for (const record of records) assert.strictEqual(record.needsResync, false);
  rmSync(sb.root, { recursive: true, force: true });
});

test('batch_global_自动剔除rules_只执行skills', async () => {
  const sb = makeSandbox('global-batch');
  const fakeHome = path.join(sb.root, 'home');
  mkdirSync(fakeHome);
  const service = makeService(sb);
  const savedHome = process.env.HOME;
  process.env.HOME = fakeHome;
  try {
    const batch = await service.runBatch({
      libraryRoot: sb.root,
      tools: ['codex'], modules: ['rules', 'skills'], scope: 'global',
    });
    assert.strictEqual(batch.results.length, 1, 'global 不执行 rules 单元');
    assert.strictEqual(batch.results[0].unit.module, 'skills');
    assert.strictEqual(batch.results[0].outcome, 'applied');
    assert.ok(existsSync(path.join(fakeHome, '.agents/skills/alpha')), 'global 目标写入临时 HOME');
    assert.strictEqual(existsSync(path.join(sb.project, 'AGENTS.md')), false, '不写项目规则文件');
  } finally {
    process.env.HOME = savedHome;
  }
  rmSync(sb.root, { recursive: true, force: true });
});

test('单项link与unlink_不更新模块lastSuccess_保持needsResync', async () => {
  const sb = makeSandbox('single-op');
  const service = makeService(sb);
  const store = new SyncStatusStore(sb.statusFile);
  const key = {
    libraryRoot: realpathSync(sb.root), targetRoot: realpathSync(sb.project),
    tool: 'codex' as SyncTool, module: 'skills' as SyncModule, scope: 'project' as SyncScope,
  };

  const applied = await service.runUnit({
    libraryRoot: sb.root, projectRoot: sb.project, tool: 'codex', module: 'skills', scope: 'project',
  });
  assert.strictEqual(applied.outcome, 'applied');
  const original = (await store.get(key))!;
  const originalCompletedAt = original.lastSuccess!.completedAt;

  const targetBase = path.join(sb.project, '.agents', 'skills');
  await service.runSingleSkillWrite({
    libraryRoot: sb.root, projectRoot: sb.project, scope: 'project',
    units: [{ tool: 'codex', targetBase }],
    action: 'link',
    write: async () => ({ count: 1 }),
  });

  let record = (await store.get(key))!;
  assert.strictEqual(record.lastSuccess?.completedAt, originalCompletedAt, '单项链接不更新模块成功时间');
  assert.strictEqual(record.needsResync, true, '单项链接后模块保持待同步');
  assert.strictEqual(record.lastAttempt?.state, 'succeeded');
  assert.strictEqual(record.lastAttempt?.reasonCode, 'skill_link');

  await service.runSingleSkillWrite({
    libraryRoot: sb.root, projectRoot: sb.project, scope: 'project',
    units: [{ tool: 'codex', targetBase }],
    action: 'unlink',
    write: async () => ({ count: 1 }),
  });
  record = (await store.get(key))!;
  assert.strictEqual(record.lastSuccess?.completedAt, originalCompletedAt, '卸载同样不改写成功基线');
  assert.strictEqual(record.needsResync, true, '卸载使模块失效');
  assert.strictEqual(record.lastAttempt?.reasonCode, 'skill_unlink');
  rmSync(sb.root, { recursive: true, force: true });
});

test('单项global写入_不污染project记录', async () => {
  const sb = makeSandbox('single-global');
  const fakeHome = path.join(sb.root, 'home');
  mkdirSync(fakeHome);
  const service = makeService(sb);
  const store = new SyncStatusStore(sb.statusFile);
  const projectKey = {
    libraryRoot: realpathSync(sb.root), targetRoot: realpathSync(sb.project),
    tool: 'codex' as SyncTool, module: 'skills' as SyncModule, scope: 'project' as SyncScope,
  };

  await service.runUnit({
    libraryRoot: sb.root, projectRoot: sb.project, tool: 'codex', module: 'skills', scope: 'project',
  });
  const before = JSON.stringify(await store.get(projectKey));

  const savedHome = process.env.HOME;
  process.env.HOME = fakeHome;
  try {
    await service.runSingleSkillWrite({
      libraryRoot: sb.root, scope: 'global',
      units: [{ tool: 'codex', targetBase: path.join(fakeHome, '.agents', 'skills') }],
      action: 'link',
      write: async () => ({ count: 1 }),
    });
  } finally {
    process.env.HOME = savedHome;
  }

  assert.strictEqual(JSON.stringify(await store.get(projectKey)), before, 'global 单项操作不触碰 project 记录');
  const globals = await store.list({ scope: 'global' });
  assert.strictEqual(globals.length, 1);
  assert.strictEqual(globals[0].needsResync, true);
  assert.strictEqual(globals[0].lastSuccess, undefined, 'global 单项操作不产生成功基线');
  rmSync(sb.root, { recursive: true, force: true });
});

test('共享目录单项写入_另一工具模块记录失效_历史保留', async () => {
  const sb = makeSandbox('single-shared');
  const service = makeService(sb);
  const store = new SyncStatusStore(sb.statusFile);
  const keyOf = (tool: SyncTool) => ({
    libraryRoot: realpathSync(sb.root), targetRoot: realpathSync(sb.project),
    tool, module: 'skills' as SyncModule, scope: 'project' as SyncScope,
  });

  for (const tool of ['codex', 'claude'] as SyncTool[]) {
    const result = await service.runUnit({
      libraryRoot: sb.root, projectRoot: sb.project, tool, module: 'skills', scope: 'project',
    });
    assert.strictEqual(result.outcome, 'applied');
  }
  const codexBefore = (await store.get(keyOf('codex')))!;
  const claudeBefore = (await store.get(keyOf('claude')))!;

  // codex 的单项链接写共享 .agents/skills → claude 模块记录被失效
  await service.runSingleSkillWrite({
    libraryRoot: sb.root, projectRoot: sb.project, scope: 'project',
    units: [{ tool: 'codex', targetBase: path.join(sb.project, '.agents', 'skills') }],
    action: 'link',
    write: async () => ({ count: 1 }),
  });

  const claudeAfter = (await store.get(keyOf('claude')))!;
  assert.strictEqual(claudeAfter.needsResync, true, '共享目录被单项写入 → 另一工具模块失效');
  assert.strictEqual(claudeAfter.lastSuccess?.completedAt, claudeBefore.lastSuccess?.completedAt, '历史成功记录保留');
  const codexAfter = (await store.get(keyOf('codex')))!;
  assert.strictEqual(codexAfter.needsResync, true);
  assert.strictEqual(codexAfter.lastAttempt?.reasonCode, 'skill_link');
  assert.strictEqual(
    codexAfter.lastSuccess?.completedAt,
    codexBefore.lastSuccess?.completedAt,
    '单项操作保留原成功基线、不新建成功记录',
  );
  rmSync(sb.root, { recursive: true, force: true });
});

test('单项写入失败_记录failed并原样抛出', async () => {
  const sb = makeSandbox('single-fail');
  const service = makeService(sb);
  const store = new SyncStatusStore(sb.statusFile);

  await assert.rejects(
    () => service.runSingleSkillWrite({
      libraryRoot: sb.root, projectRoot: sb.project, scope: 'project',
      units: [{ tool: 'codex', targetBase: path.join(sb.project, '.agents', 'skills') }],
      action: 'link',
      write: async () => { throw new Error('boom'); },
    }),
    /boom/,
  );

  const record = await store.list({ module: 'skills' }).then((all) => all[0]);
  assert.strictEqual(record?.lastAttempt?.state, 'failed');
  assert.strictEqual(record?.lastAttempt?.reasonCode, 'single_write_failed');
  assert.strictEqual(record?.needsResync, true);
  assert.strictEqual(record?.lastSuccess, undefined);
  rmSync(sb.root, { recursive: true, force: true });
});
