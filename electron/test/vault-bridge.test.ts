// electron/test/vault-bridge.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runAiwsBridge, assertAiws, runAiwsJson } from '../src/core/vault-bridge';
import { ErrorCodes } from '../src/core/errors';

test('assertAiws 缺 aiws 脚本抛 AiwsNotInstalled', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'aiws-bridge-'));
  await assert.rejects(assertAiws(root), (e: any) => e.code === ErrorCodes.AiwsNotInstalled);
});

test('runAiwsBridge 执行 --version', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'aiws-bridge-'));
  mkdirSync(path.join(root, '.ai-workspace', 'scripts'), { recursive: true });
  writeFileSync(path.join(root, '.ai-workspace', 'scripts', 'aiws'), '#!/bin/sh\necho "bridge ok $*"\n', { mode: 0o755 });
  const res = await runAiwsBridge(root, ['--version']);
  assert.strictEqual(res.code, 0);
  assert.match(res.stdout, /bridge ok/);
});

function fixture(body: string): string {
  const root = mkdtempSync(path.join(tmpdir(), 'aiws-json-'));
  mkdirSync(path.join(root, '.ai-workspace', 'scripts'), { recursive: true });
  writeFileSync(path.join(root, '.ai-workspace', 'scripts', 'aiws'), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return root;
}

test('runAiwsJson_vaultNotReady_returnsStructuredState', async () => {
  const root = fixture(`printf '%s' '{"secrets":[],"vault_ready":false}'`);

  const result = await runAiwsJson(root, ['secrets', 'list', '--json']);

  assert.deepStrictEqual(result, { secrets: [], vault_ready: false });
});

test('runAiwsJson_invalidOutput_throwsInsteadOfEmptyState', async () => {
  const root = fixture('echo not-json');

  await assert.rejects(runAiwsJson(root, ['secrets', 'audit', '--json']), /JSON/);
});

test('runAiwsJson_nonzeroExit_rejectsEvenWithValidJson', async () => {
  const root = fixture(`echo '{}'; exit 2`);

  await assert.rejects(runAiwsJson(root, ['secrets', 'list', '--json']), /退出码 2/);
});

test('runAiwsBridge_explicitRoot_overridesInheritedWorkspace', async () => {
  const root = fixture('printf "%s" "$AIWS_ROOT"');

  const result = await runAiwsBridge(root, ['--version']);

  assert.strictEqual(result.stdout, root);
});

test('runAiwsJson_realCli_vaultNotInitializedDoesNotRequireDecryption', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'aiws-vault-real-'));
  cpSync(path.resolve(__dirname, '../../.ai-workspace/scripts'), path.join(root, '.ai-workspace/scripts'), { recursive: true });

  const result = await runAiwsJson(root, ['secrets', 'list', '--json']) as { vault_ready: boolean; secrets: string[] };
  const audit = await runAiwsJson(root, ['secrets', 'audit', '--json']) as { tools: unknown[] };

  assert.strictEqual(result.vault_ready, false);
  assert.deepStrictEqual(result.secrets, []);
  assert.ok(Array.isArray(audit.tools));
});
