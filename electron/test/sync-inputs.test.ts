// electron/test/sync-inputs.test.ts
// 功能 002 TASK-002-02：真实 CLI describe-inputs + 三模块指纹（AC-002-03/04/05/13/18 相关切片）。
// 全部使用临时库与合成密钥；不读写真实全局目录、vault 或 userData。
import { test } from 'node:test';
import assert from 'node:assert';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
  appendFileSync,
  readFileSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  describeSyncInputs,
  loadDescriptorInputs,
  computeUnitFingerprints,
  readStableFile,
  SyncInputsDescriptor,
} from '../src/core/sync-inputs';
import { SyncModule, SyncScope, SyncTool } from '../src/shared/sync-status';

const KEY = randomBytes(32);

interface Sandbox {
  root: string;
  aiws: string;
  project: string;
  cli: string;
  scriptsDir: string;
}

function makeSandbox(name: string, order: 'forward' | 'reverse' = 'forward'): Sandbox {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), `aiws-inputs-${name}-`)));
  const aiws = path.join(root, '.ai-workspace');
  const project = path.join(root, 'project');
  mkdirSync(project);
  cpSync(path.resolve(__dirname, '../../.ai-workspace/scripts'), path.join(aiws, 'scripts'), { recursive: true });

  const dirs = [
    'rules/domains', 'memory/context', 'memory/adr', 'config',
    'adapters/cursor', 'adapters/trae', 'skills/alpha', 'skills/beta', 'mcp', 'secrets',
  ];
  for (const dir of dirs) mkdirSync(path.join(aiws, dir), { recursive: true });

  const writes: Array<[string, string]> = [
    ['rules/00-core.md', '---\nid: 00-core\ntitle: Core\nscope: all\n---\n# CORE_BODY_V1\n'],
    ['rules/only-cursor.md', '---\nid: only-cursor\ntitle: OnlyCursor\nscope: all\ntools: [cursor]\n---\n# CURSOR_ONLY_V1\n'],
    ['rules/domains/api.md', '---\nid: api\ntitle: API\nscope: all\n---\n# API_BODY_V1\n'],
    ['rules/CHANGELOG.md', '# v1\n'],
    ['rules/.manifest.sha256', 'deadbeef\n'],
    ['memory/context/project.md', '---\nname: project\n---\nCTX_V1\n'],
    ['memory/context/TEMPLATE.md', '# TEMPLATE\n'],
    ['memory/adr/0001-choice.md', '# ADR\n'],
    ['config/workspace.json', '{"version":"1.0","tools":["codex","claude","cursor","trae"],"default_scope":"project"}\n'],
    ['adapters/cursor/mapping.yaml', 'tool: cursor\nrules:\n  - source: rules/00-core.md\n    required: true\n  - source: rules/domains/api.md\n    required: true\n  - source: rules/only-cursor.md\n    required: true\n'],
    ['adapters/trae/mapping.yaml', 'tool: trae\nrules:\n  - source: rules/00-core.md\n    required: true\n  - source: rules/domains/api.md\n    required: true\n'],
    ['skills/alpha/SKILL.md', '# SKILL ALPHA\n'],
    ['skills/alpha/helper.sh', '#!/bin/sh\necho alpha\n'],
    ['skills/alpha/data/config.json', '{"a":1}\n'],
    ['skills/beta/SKILL.md', '# SKILL BETA\n'],
    ['mcp/mcp.json', JSON.stringify({
      servers: {
        filesystem: { command: 'npx', args: ['fs'], scope: ['project', 'global'], env: { TOKEN: '${secret:FS_TOKEN}' } },
        'browser-use': { command: 'npx', args: ['bu'], scope: ['project'] },
        node_repl: { command: 'npx', args: ['nr'], scope: ['global'] },
      },
    }) + '\n'],
    ['mcp/mcp.local.json', JSON.stringify({
      servers: { 'browser-use': { command: 'npx', args: ['bu-local'], scope: ['project'] } },
    }) + '\n'],
    ['secrets/permissions.yaml', 'codex:\n  - FS_TOKEN\n'],
    ['secrets/vault.enc', 'not-really-encrypted-bytes\n'],
  ];
  const ordered = order === 'forward' ? writes : [...writes].reverse();
  for (const [rel, content] of ordered) {
    const file = path.join(aiws, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  // 可执行位与技能内软链接（库内、合法）
  const helper = path.join(aiws, 'skills/alpha/helper.sh');
  writeFileSync(helper, readFileSync(helper), { mode: 0o755 });
  symlinkSync(path.join(aiws, 'skills/alpha/SKILL.md'), path.join(aiws, 'skills/alpha/alias.md'));

  return { root, aiws, project, cli: path.join(aiws, 'scripts/aiws'), scriptsDir: path.join(aiws, 'scripts') };
}

async function fingerprintUnit(
  sb: Sandbox,
  tool: SyncTool,
  module: SyncModule,
  scope: SyncScope = 'project',
): Promise<{ descriptor: SyncInputsDescriptor; source: string | null; effective: string | null }> {
  const descriptor = await describeSyncInputs({
    libraryRoot: sb.root, targetRoot: sb.project, tool, module, scope, cliPath: sb.cli,
  });
  if (!descriptor.executable) return { descriptor, source: null, effective: null };
  const loaded = await loadDescriptorInputs(descriptor, { libraryRoot: sb.root, scriptsDir: sb.scriptsDir });
  const fp = computeUnitFingerprints(KEY, descriptor, loaded);
  return { descriptor, source: fp.sourceFingerprint, effective: fp.effectiveOutputFingerprint ?? null };
}

test('AC-002-03_规则正文修改_仅规则单元指纹变化', async () => {
  const sb = makeSandbox('rule-body');
  const before = await fingerprintUnit(sb, 'codex', 'rules');
  const skillsBefore = await fingerprintUnit(sb, 'codex', 'skills');
  const mcpBefore = await fingerprintUnit(sb, 'codex', 'mcp');

  writeFileSync(path.join(sb.aiws, 'rules/00-core.md'), '---\nid: 00-core\ntitle: Core\nscope: all\n---\n# CORE_BODY_V2\n');

  const after = await fingerprintUnit(sb, 'codex', 'rules');
  const skillsAfter = await fingerprintUnit(sb, 'codex', 'skills');
  const mcpAfter = await fingerprintUnit(sb, 'codex', 'mcp');
  assert.notStrictEqual(after.source, before.source, '规则正文变化必须改变规则指纹');
  assert.strictEqual(skillsAfter.source, skillsBefore.source);
  assert.strictEqual(mcpAfter.source, mcpBefore.source);
  rmSync(sb.root, { recursive: true, force: true });
});

test('AC-002-03_mapping_required修改_cursor规则变化_codex不变', async () => {
  const sb = makeSandbox('mapping-required');
  const codexBefore = await fingerprintUnit(sb, 'codex', 'rules');
  const cursorBefore = await fingerprintUnit(sb, 'cursor', 'rules');

  const mapping = path.join(sb.aiws, 'adapters/cursor/mapping.yaml');
  writeFileSync(mapping, 'tool: cursor\nrules:\n  - source: rules/00-core.md\n    required: true\n  - source: rules/domains/api.md\n    required: true\n');

  const codexAfter = await fingerprintUnit(sb, 'codex', 'rules');
  const cursorAfter = await fingerprintUnit(sb, 'cursor', 'rules');
  assert.strictEqual(codexAfter.source, codexBefore.source, 'codex 不消费 mapping，不受影响');
  assert.notStrictEqual(cursorAfter.source, cursorBefore.source, 'cursor 消费 mapping，必须失效');
  rmSync(sb.root, { recursive: true, force: true });
});

test('AC-002-03_memory_context变化_规则指纹变化', async () => {
  const sb = makeSandbox('context');
  const before = await fingerprintUnit(sb, 'claude', 'rules');

  appendFileSync(path.join(sb.aiws, 'memory/context/project.md'), 'CTX_EXTRA\n');

  const after = await fingerprintUnit(sb, 'claude', 'rules');
  assert.notStrictEqual(after.source, before.source);
  rmSync(sb.root, { recursive: true, force: true });
});

test('AC-002-03_skill附属文件修改_指纹与计划版本变化', async () => {
  const sb = makeSandbox('skill附属');
  const before = await fingerprintUnit(sb, 'codex', 'skills');

  appendFileSync(path.join(sb.aiws, 'skills/alpha/data/config.json'), '{"b":2}\n');

  const after = await fingerprintUnit(sb, 'codex', 'skills');
  assert.notStrictEqual(after.source, before.source, '附属文件变化必须改变来源指纹');
  assert.notStrictEqual(after.effective, before.effective, '内容版本变化必须改变有效输出指纹');
  rmSync(sb.root, { recursive: true, force: true });
});

test('AC-002-03_mcp本地覆盖修改与删除_仅MCP指纹变化', async () => {
  const sb = makeSandbox('mcp-local');
  const mcpBefore = await fingerprintUnit(sb, 'codex', 'mcp');
  const rulesBefore = await fingerprintUnit(sb, 'codex', 'rules');

  writeFileSync(path.join(sb.aiws, 'mcp/mcp.local.json'), JSON.stringify({
    servers: { 'browser-use': { command: 'npx', args: ['bu-local-v2'], scope: ['project'] } },
  }) + '\n');
  const mcpModified = await fingerprintUnit(sb, 'codex', 'mcp');
  assert.notStrictEqual(mcpModified.source, mcpBefore.source);

  rmSync(path.join(sb.aiws, 'mcp/mcp.local.json'));
  const mcpRemoved = await fingerprintUnit(sb, 'codex', 'mcp');
  assert.notStrictEqual(mcpRemoved.source, mcpModified.source, '删除有效覆盖必须被识别');

  const rulesAfter = await fingerprintUnit(sb, 'codex', 'rules');
  assert.strictEqual(rulesAfter.source, rulesBefore.source);
  rmSync(sb.root, { recursive: true, force: true });
});

test('AC-002-03_删除规则文件_指纹变化', async () => {
  const sb = makeSandbox('rule-delete');
  const before = await fingerprintUnit(sb, 'claude', 'rules');

  rmSync(path.join(sb.aiws, 'rules/domains/api.md'));

  const after = await fingerprintUnit(sb, 'claude', 'rules');
  assert.notStrictEqual(after.source, before.source);
  rmSync(sb.root, { recursive: true, force: true });
});

test('AC-002-04_相同输入重复描述_指纹确定性且与写入顺序无关', async () => {
  const sbA = makeSandbox('determinism-a', 'forward');
  const sbB = makeSandbox('determinism-b', 'reverse');
  const a = await fingerprintUnit(sbA, 'cursor', 'rules');
  const b = await fingerprintUnit(sbB, 'cursor', 'rules');
  const a2 = await fingerprintUnit(sbA, 'cursor', 'rules');
  assert.strictEqual(a.source, a2.source, '同一库重复描述必须得到相同指纹');
  assert.strictEqual(a.source, b.source, '文件创建顺序不影响指纹');
  rmSync(sbA.root, { recursive: true, force: true });
  rmSync(sbB.root, { recursive: true, force: true });
});

test('AC-002-04_mcp对象键序不变_参数数组换序改变指纹', async () => {
  const sb = makeSandbox('mcp-order');
  const before = await fingerprintUnit(sb, 'cursor', 'mcp');

  // 对象键重排（内容等价）
  const reordered = {
    servers: {
      node_repl: { command: 'npx', args: ['nr'], scope: ['global'] },
      'browser-use': { command: 'npx', args: ['bu-local'], scope: ['project'] },
      filesystem: { command: 'npx', args: ['fs'], scope: ['project', 'global'], env: { TOKEN: '${secret:FS_TOKEN}' } },
    },
  };
  writeFileSync(path.join(sb.aiws, 'mcp/mcp.json'), JSON.stringify(reordered) + '\n');
  const afterReorder = await fingerprintUnit(sb, 'cursor', 'mcp');
  assert.strictEqual(afterReorder.source, before.source, '对象键序不改变指纹');

  // 参数数组换序（内容有序）
  writeFileSync(path.join(sb.aiws, 'mcp/mcp.json'), JSON.stringify({
    servers: {
      filesystem: { command: 'npx', args: ['fs'], scope: ['project', 'global'], env: { TOKEN: '${secret:FS_TOKEN}' } },
      'browser-use': { command: 'npx', args: ['bu-local'], scope: ['project'] },
      node_repl: { command: 'npx', args: ['nr'], scope: ['global'] },
    },
  }) + '\n');
  writeFileSync(path.join(sb.aiws, 'mcp/mcp.local.json'), JSON.stringify({
    servers: { 'browser-use': { command: 'npx', args: ['bu-local', '--extra'], scope: ['project'] } },
  }) + '\n');
  const afterArrayChange = await fingerprintUnit(sb, 'cursor', 'mcp');
  assert.notStrictEqual(afterArrayChange.source, before.source, '数组顺序敏感');
  rmSync(sb.root, { recursive: true, force: true });
});

test('AC-002-04_无关产物与不适用规则不影响指纹', async () => {
  const sb = makeSandbox('irrelevant');
  const before = await fingerprintUnit(sb, 'codex', 'rules');

  appendFileSync(path.join(sb.aiws, 'rules/CHANGELOG.md'), '# v2\n');
  writeFileSync(path.join(sb.aiws, 'rules/.manifest.sha256'), 'cafebabe\n');
  writeFileSync(path.join(sb.aiws, 'memory/adr/0002-new.md'), '# ADR2\n');
  appendFileSync(path.join(sb.aiws, 'rules/only-cursor.md'), 'EDIT cursor only\n');

  const after = await fingerprintUnit(sb, 'codex', 'rules');
  assert.strictEqual(after.source, before.source, 'CHANGELOG/manifest/ADR/不适用工具规则均不影响 codex');
  rmSync(sb.root, { recursive: true, force: true });
});

test('AC-002-05_生成器依赖变化_仅消费该依赖的单元失效', async () => {
  const sb = makeSandbox('generator-deps');
  const codexBefore = await fingerprintUnit(sb, 'codex', 'rules');
  const cursorBefore = await fingerprintUnit(sb, 'cursor', 'rules');
  const skillsBefore = await fingerprintUnit(sb, 'codex', 'skills');

  appendFileSync(path.join(sb.scriptsDir, 'lib/rules-generate.sh'), '\n# describe-dep-change probe\n');

  const codexAfter = await fingerprintUnit(sb, 'codex', 'rules');
  const cursorAfter = await fingerprintUnit(sb, 'cursor', 'rules');
  const skillsAfter = await fingerprintUnit(sb, 'codex', 'skills');
  assert.notStrictEqual(cursorAfter.source, cursorBefore.source, 'cursor 规则依赖 rules-generate.sh');
  assert.strictEqual(codexAfter.source, codexBefore.source, 'codex 规则不依赖 rules-generate.sh');
  assert.strictEqual(skillsAfter.source, skillsBefore.source, 'skills 不依赖 rules-generate.sh');
  rmSync(sb.root, { recursive: true, force: true });
});

test('AC-002-13_执行前后来源变化_结束指纹与开始指纹不同', async () => {
  const sb = makeSandbox('start-end');
  const start = await fingerprintUnit(sb, 'claude', 'rules');

  appendFileSync(path.join(sb.aiws, 'memory/context/project.md'), 'MID_SYNC_EDIT\n');

  const end = await fingerprintUnit(sb, 'claude', 'rules');
  assert.notStrictEqual(end.source, start.source, '来源在执行期间变化必须可被 start/end 比对发现');
  rmSync(sb.root, { recursive: true, force: true });
});

test('AC-002-02_skills计划跨工具等价_有效输出指纹相同而来源指纹不同', async () => {
  const sb = makeSandbox('equivalence');
  const codex = await fingerprintUnit(sb, 'codex', 'skills');
  const claude = await fingerprintUnit(sb, 'claude', 'skills');
  assert.ok(codex.effective && claude.effective);
  assert.strictEqual(codex.effective, claude.effective, '共享 .agents/skills 的等价计划必须同指纹');
  assert.notStrictEqual(codex.source, claude.source, '来源指纹含工具身份');
  rmSync(sb.root, { recursive: true, force: true });
});

test('AC-002-18_describe不创建密钥_输出不含配置正文或凭据值', async () => {
  const sb = makeSandbox('no-secrets');
  const { descriptor } = await fingerprintUnit(sb, 'codex', 'mcp');
  const raw = JSON.stringify(descriptor);
  assert.ok(!raw.includes('CORE_BODY'), '描述不得包含规则正文');
  assert.ok(!raw.includes('npx'), '描述不得包含 MCP 命令正文');
  assert.ok(!raw.includes('FS_TOKEN') || raw.includes('secrets/permissions.yaml'), '仅允许出现权限文件路径');
  assert.ok(raw.includes('secrets/vault.enc'), 'vault 以路径参与，不解密');
  // 全程无密钥文件落盘
  const keyCandidates = [
    path.join(sb.root, 'sync-fingerprint.key'),
    path.join(sb.aiws, 'sync-fingerprint.key'),
    path.join(sb.project, 'sync-fingerprint.key'),
  ];
  for (const file of keyCandidates) {
    await assert.rejects(() => readStableFile(file), /ENOENT/);
  }
  rmSync(sb.root, { recursive: true, force: true });
});

test('AC-002-18_同key来源变化与换key可区分', async () => {
  const sb = makeSandbox('key-vs-source');
  const otherKey = randomBytes(32);
  const v1 = await fingerprintUnit(sb, 'codex', 'rules');

  appendFileSync(path.join(sb.aiws, 'rules/00-core.md'), 'V2\n');
  const v2 = await fingerprintUnit(sb, 'codex', 'rules');
  assert.notStrictEqual(v2.source, v1.source, '同 keyId 下来源变化可区分');

  const descriptor = v1.descriptor;
  const loaded = await loadDescriptorInputs(descriptor, { libraryRoot: sb.root, scriptsDir: sb.scriptsDir });
  const withOtherKey = computeUnitFingerprints(otherKey, descriptor, loaded);
  assert.notStrictEqual(withOtherKey.sourceFingerprint, v2.source, '换 key 与来源变化可区分');
  assert.notStrictEqual(withOtherKey.sourceFingerprint, v1.source);
  rmSync(sb.root, { recursive: true, force: true });
});

test('AC-002-18_技能内库内软链接_记录链接值与有效内容', async () => {
  const sb = makeSandbox('skill-link');
  const { descriptor } = await fingerprintUnit(sb, 'codex', 'skills');
  const entry = descriptor.skillsPlan?.entries.find((item) => item.relativePath === 'alpha');
  assert.ok(entry, 'alpha 技能存在');
  const aliasLine = entry.manifest.find((line) => line.startsWith('alias.md|link|'));
  assert.ok(aliasLine, '别名链接被记录');
  assert.match(aliasLine, /\|link\|.+\|[0-9a-f]{64}$/, '链接携带有效内容哈希');
  rmSync(sb.root, { recursive: true, force: true });
});

test('AC-002-03_坏MCP覆盖JSON_读取时显式失败不降级', async () => {
  const sb = makeSandbox('bad-override');
  const descriptor = await describeSyncInputs({
    libraryRoot: sb.root, targetRoot: sb.project, tool: 'codex', module: 'mcp', scope: 'project', cliPath: sb.cli,
  });
  assert.ok(descriptor.mcp?.override, '覆盖文件在描述时有效');

  writeFileSync(path.join(sb.aiws, 'mcp/mcp.local.json'), 'not-json{{{');
  await assert.rejects(
    () => loadDescriptorInputs(descriptor, { libraryRoot: sb.root, scriptsDir: sb.scriptsDir }),
    /不是有效 JSON/,
  );
  rmSync(sb.root, { recursive: true, force: true });
});

test('不可执行单元_返回原因码且拒绝计算指纹', async () => {
  const sb = makeSandbox('disabled');
  writeFileSync(path.join(sb.aiws, 'config/workspace.json'), JSON.stringify({
    version: '1.0', tools: ['codex', 'claude', 'cursor', 'trae'], default_scope: 'project', skills: { enabled: false },
  }) + '\n');

  const descriptor = await describeSyncInputs({
    libraryRoot: sb.root, targetRoot: sb.project, tool: 'codex', module: 'skills', scope: 'project', cliPath: sb.cli,
  });
  assert.strictEqual(descriptor.executable, false);
  assert.strictEqual(descriptor.reasonCode, 'module_disabled');
  assert.throws(() => computeUnitFingerprints(KEY, descriptor, { files: [], deps: [] }), /不可执行/);
  rmSync(sb.root, { recursive: true, force: true });
});

test('AC-002-18_读取期间变化_显式失败', async () => {
  const file = path.join(realpathSync(mkdtempSync(path.join(tmpdir(), 'aiws-stable-'))), 'x.txt');
  writeFileSync(file, 'before');
  let calls = 0;
  await assert.rejects(
    () => readStableFile(file, {
      stat: async () => { calls += 1; return { size: calls, mtimeMs: calls, mode: 0o644 }; },
      read: async () => Buffer.from('after'),
    }),
    /读取期间发生变化/,
  );
  const ok = await readStableFile(file);
  assert.strictEqual(ok.executable, false);
  rmSync(path.dirname(file), { recursive: true, force: true });
});

test('describeSyncInputs_未知工具_显式失败', async () => {
  const sb = makeSandbox('bad-tool');
  await assert.rejects(
    () => describeSyncInputs({
      libraryRoot: sb.root, targetRoot: sb.project,
      tool: 'not-a-tool' as SyncTool, module: 'rules', scope: 'project', cliPath: sb.cli,
    }),
    /describe-inputs 失败/,
  );
  rmSync(sb.root, { recursive: true, force: true });
});
