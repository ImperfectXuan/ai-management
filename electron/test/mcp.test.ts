// electron/test/mcp.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listMcp, addMcp, removeMcp, mergeLocalMcp, getServersForScope } from '../src/core/mcp';

function makeWorkspace(servers: Record<string, unknown>) {
  const root = mkdtempSync(path.join(tmpdir(), 'aiws-mcp-'));
  mkdirSync(path.join(root, '.ai-workspace', 'mcp'), { recursive: true });
  writeFileSync(path.join(root, '.ai-workspace', 'mcp', 'mcp.json'), JSON.stringify({ servers }, null, 2));
  return root;
}

test('listMcp 返回 name + command', async () => {
  const root = makeWorkspace({ filesystem: { command: 'npx', args: ['-y', 'x'] } });
  const list = await listMcp(root);
  assert.deepStrictEqual(list, [{ name: 'filesystem', command: 'npx', args: ['-y', 'x'] }]);
});

test('addMcp 写入 scope 默认 project', async () => {
  const root = makeWorkspace({});
  await addMcp(root, 'server-a', 'npx', ['-y', 'b']);
  const list = await listMcp(root);
  assert.deepStrictEqual(list, [{ name: 'server-a', command: 'npx', args: ['-y', 'b'], scope: ['project'] }]);
});

test('removeMcp 删除', async () => {
  const root = makeWorkspace({ a: { command: 'x' }, b: { command: 'y' } });
  await removeMcp(root, 'a');
  assert.deepStrictEqual((await listMcp(root)).map((s) => s.name), ['b']);
});

test('getServersForScope 过滤', () => {
  const servers = {
    g: { command: 'x', scope: ['global'] },
    b: { command: 'y', scope: ['global', 'project'] },
    n: { command: 'z' },
  };
  const project = getServersForScope(servers, 'project');
  assert.deepStrictEqual(Object.keys(project).sort(), ['b', 'n']);
});

test('mergeLocalMcp 本地覆盖', () => {
  const merged = mergeLocalMcp({ a: { command: 'x' } }, { a: { command: 'y' } });
  assert.strictEqual(merged.a.command, 'y');
});
