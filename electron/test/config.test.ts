// electron/test/config.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, getToolMcpPath, getToolSkillsPath } from '../src/core/config';

test('loadConfig 缺文件时返回默认', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aiws-'));
  const cfg = await loadConfig(dir);
  assert.deepStrictEqual(cfg.tools, ['codex', 'claude', 'cursor', 'trae']);
  assert.strictEqual(cfg.default_scope, 'project');
});

test('loadConfig 读取 workspace.json', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aiws-'));
  mkdirSync(path.join(dir, 'config'), { recursive: true });
  writeFileSync(path.join(dir, 'config', 'workspace.json'), JSON.stringify({ version: '1.0', tools: ['cursor'], default_scope: 'global' }));
  const cfg = await loadConfig(dir);
  assert.deepStrictEqual(cfg.tools, ['cursor']);
  assert.strictEqual(cfg.default_scope, 'global');
});

test('getToolMcpPath project cursor 指向仓库 .cursor/mcp.json', () => {
  assert.strictEqual(getToolMcpPath('/repo', 'cursor', 'project'), path.join('/repo', '.cursor', 'mcp.json'));
});

test('getToolSkillsPath global trae 指向 ~/.trae/skills', () => {
  const home = process.env.HOME ?? '';
  assert.strictEqual(getToolSkillsPath('/repo', 'trae', 'global'), path.join(home, '.trae', 'skills'));
});
