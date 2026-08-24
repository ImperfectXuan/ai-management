// electron/test/sync.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { generateRuleFiles, syncRun } from '../src/core/sync';

function makeWorkspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'aiws-sync-'));
  const aiws = path.join(root, '.ai-workspace');
  mkdirSync(path.join(aiws, 'rules', 'domains'), { recursive: true });
  mkdirSync(path.join(aiws, 'adapters', 'cursor'), { recursive: true });
  mkdirSync(path.join(aiws, 'adapters', 'trae'), { recursive: true });
  mkdirSync(path.join(aiws, 'mcp'), { recursive: true });
  writeFileSync(path.join(aiws, 'rules', '00-core.md'), '---\nid: 00-core\ntitle: Core\nscope: all\n---\n# Core Body\n');
  writeFileSync(
    path.join(aiws, 'adapters', 'cursor', 'mapping.yaml'),
    'tool: cursor\nrules:\n  - source: rules/00-core.md\n    required: true\n'
  );
  writeFileSync(
    path.join(aiws, 'adapters', 'trae', 'mapping.yaml'),
    'tool: trae\nrules:\n  - source: rules/00-core.md\n    required: true\n'
  );
  writeFileSync(
    path.join(aiws, 'mcp', 'mcp.json'),
    JSON.stringify({ servers: { fs: { command: 'npx', scope: ['project'] } } })
  );
  return root;
}

test('generateRuleFiles 生成 cursor .mdc 带 frontmatter 与正文', async () => {
  const root = makeWorkspace();
  const { count } = await generateRuleFiles(root, 'cursor');
  assert.strictEqual(count, 1);
  const out = await fs.readFile(path.join(root, '.cursor', 'rules', '00-core.mdc'), 'utf8');
  assert.match(out, /alwaysApply: true/);
  assert.match(out, /globs: "\*\*\/\*"/);
  assert.match(out, /# Core Body/);
});

test('generateRuleFiles 清空陈旧文件（幂等）', async () => {
  const root = makeWorkspace();
  mkdirSync(path.join(root, '.cursor', 'rules'), { recursive: true });
  writeFileSync(path.join(root, '.cursor', 'rules', 'stale.mdc'), 'old');
  const { count, backedUp } = await generateRuleFiles(root, 'cursor');
  assert.strictEqual(count, 1);
  const files = await fs.readdir(path.join(root, '.cursor', 'rules'));
  // 生成的 00-core.mdc 存在
  assert.ok(files.includes('00-core.mdc'), '应生成 00-core.mdc');
  // 原 stale.mdc 被备份为 stale.mdc.bak，而非删除
  assert.ok(files.includes('stale.mdc.bak'), '陈旧文件应被备份为 .bak');
  assert.ok(!files.includes('stale.mdc'), '原文件应被移走');
  assert.deepStrictEqual(backedUp, ['stale.mdc.bak']);
});

test('generateRuleFiles 用户手放文件被备份，不删除', async () => {
  const root = makeWorkspace();
  mkdirSync(path.join(root, '.cursor', 'rules'), { recursive: true });
  writeFileSync(path.join(root, '.cursor', 'rules', 'my-personal.mdc'), 'personal');
  writeFileSync(path.join(root, '.cursor', 'rules', 'another.mdc'), 'another');
  const { count, backedUp } = await generateRuleFiles(root, 'cursor');
  assert.strictEqual(count, 1);
  const files = await fs.readdir(path.join(root, '.cursor', 'rules'));
  assert.ok(files.includes('00-core.mdc'));
  assert.ok(files.includes('my-personal.mdc.bak'));
  assert.ok(files.includes('another.mdc.bak'));
  assert.ok(!files.includes('my-personal.mdc'));
  assert.ok(!files.includes('another.mdc'));
  assert.strictEqual(backedUp.length, 2);
  assert.ok(backedUp.includes('my-personal.mdc.bak'));
  assert.ok(backedUp.includes('another.mdc.bak'));
});

test('generateRuleFiles 已有 .bak 不会被新备份覆盖（用时间戳）', async () => {
  const root = makeWorkspace();
  mkdirSync(path.join(root, '.cursor', 'rules'), { recursive: true });
  // 预存 stale.mdc 与 stale.mdc.bak
  writeFileSync(path.join(root, '.cursor', 'rules', 'stale.mdc'), 'old');
  writeFileSync(path.join(root, '.cursor', 'rules', 'stale.mdc.bak'), 'previous-backup-content');
  await generateRuleFiles(root, 'cursor');
  const files = await fs.readdir(path.join(root, '.cursor', 'rules'));
  // 原 .bak 内容应保留
  const preserved = readFileSync(path.join(root, '.cursor', 'rules', 'stale.mdc.bak'), 'utf8');
  assert.strictEqual(preserved, 'previous-backup-content', '原有 .bak 不应被覆盖');
  // 新备份应使用时间戳命名（stale.mdc.<timestamp>.bak）
  const newBak = files.find((f) => f !== '00-core.mdc' && f !== 'stale.mdc.bak' && f.startsWith('stale.mdc.'));
  assert.ok(newBak && newBak.endsWith('.bak'), '新备份应用时间戳: stale.mdc.<ts>.bak');
});

test('generateRuleFiles 子目录被备份为 <name>.bak，不递归删除', async () => {
  const root = makeWorkspace();
  mkdirSync(path.join(root, '.cursor', 'rules', 'subdir'), { recursive: true });
  writeFileSync(path.join(root, '.cursor', 'rules', 'subdir', 'nested.mdc'), 'nested');
  const { backedUp } = await generateRuleFiles(root, 'cursor');
  const files = await fs.readdir(path.join(root, '.cursor', 'rules'));
  assert.ok(files.includes('subdir.bak'), '子目录应被备份为 subdir.bak');
  assert.ok(!files.includes('subdir'), '原 subdir 应被移走');
  assert.ok(backedUp.includes('subdir.bak'));
});

test('generateRuleFiles 按精确 source 匹配，foo.md 不会误命中 foo.mdx', async () => {
  const root = makeWorkspace();
  const aiws = path.join(root, '.ai-workspace');
  writeFileSync(path.join(aiws, 'rules', 'foo.md'), '---\nid: foo\ntitle: Foo\nscope: all\n---\n# Foo\n');
  writeFileSync(
    path.join(aiws, 'adapters', 'cursor', 'mapping.yaml'),
    'tool: cursor\nrules:\n  - source: rules/foo.mdx\n    required: true\n'
  );
  mkdirSync(path.join(root, '.cursor', 'rules'), { recursive: true });
  writeFileSync(path.join(root, '.cursor', 'rules', 'foo.mdc'), 'stale');

  const { count, backedUp } = await generateRuleFiles(root, 'cursor');
  const files = await fs.readdir(path.join(root, '.cursor', 'rules'));

  assert.strictEqual(count, 0, 'foo.md 不在 mapping 中时不应生成 foo.mdc');
  assert.ok(files.includes('foo.mdc.bak'), '误留的 foo.mdc 应被备份');
  assert.ok(!files.includes('foo.mdc'), '原 foo.mdc 应被移走');
  assert.deepStrictEqual(backedUp, ['foo.mdc.bak']);
});

test('syncRun 产出进度行并完成 MCP 同步', async () => {
  const root = makeWorkspace();
  const lines: string[] = [];
  for await (const line of syncRun(root)) lines.push(line);
  assert.ok(lines.some((l) => l.includes('已生成')));
  const mcpOut = await fs.readFile(path.join(root, '.cursor', 'mcp.json'), 'utf8');
  assert.ok(mcpOut.includes('mcpServers'));
});
