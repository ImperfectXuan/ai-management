// electron/test/sync.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
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
  await generateRuleFiles(root, 'cursor');
  const files = await fs.readdir(path.join(root, '.cursor', 'rules'));
  assert.deepStrictEqual(files, ['00-core.mdc']);
});

test('syncRun 产出进度行并完成 MCP 同步', async () => {
  const root = makeWorkspace();
  const lines: string[] = [];
  for await (const line of syncRun(root)) lines.push(line);
  assert.ok(lines.some((l) => l.includes('已生成')));
  const mcpOut = await fs.readFile(path.join(root, '.cursor', 'mcp.json'), 'utf8');
  assert.ok(mcpOut.includes('mcpServers'));
});
