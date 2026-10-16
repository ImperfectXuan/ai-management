// electron/test/sync-unit-receipt.test.ts
// 功能 002 TASK-002-03：单元回执的严格校验与 CLI 端到端（AC-002-08/09 切片）。
import { test } from 'node:test';
import assert from 'node:assert';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseSyncUnitReceipt, ReceiptExpectation } from '../src/shared/sync-unit-receipt';
import { syncRun } from '../src/core/sync';

const EXPECTED: ReceiptExpectation = {
  operationId: 'op-123',
  tool: 'codex',
  module: 'rules',
  scope: 'project',
};

const VALID_APPLIED = JSON.stringify({
  schemaVersion: 1,
  operationId: 'op-123',
  tool: 'codex',
  module: 'rules',
  scope: 'project',
  outcome: 'applied',
  completedAt: '2026-10-16T06:00:00Z',
});

test('parse_合法applied_通过', () => {
  const receipt = parseSyncUnitReceipt(VALID_APPLIED, EXPECTED);
  assert.strictEqual(receipt.outcome, 'applied');
  assert.strictEqual(receipt.completedAt, '2026-10-16T06:00:00Z');
  assert.strictEqual(receipt.reasonCode, undefined);
});

test('parse_合法skipped与failed_通过并保留原因', () => {
  const skipped = parseSyncUnitReceipt(JSON.stringify({
    schemaVersion: 1, operationId: 'op-123', tool: 'codex', module: 'rules',
    scope: 'project', outcome: 'skipped', reasonCode: 'no_entries',
  }), EXPECTED);
  assert.strictEqual(skipped.reasonCode, 'no_entries');

  const failed = parseSyncUnitReceipt(JSON.stringify({
    schemaVersion: 1, operationId: 'op-123', tool: 'codex', module: 'rules',
    scope: 'project', outcome: 'failed', reasonCode: 'invalid_config',
  }), EXPECTED);
  assert.strictEqual(failed.outcome, 'failed');
});

test('parse_坏JSON或非对象_拒绝', () => {
  assert.throws(() => parseSyncUnitReceipt('not-json{{{', EXPECTED), /不是有效 JSON/);
  assert.throws(() => parseSyncUnitReceipt('[]', EXPECTED), /不是对象/);
  assert.throws(() => parseSyncUnitReceipt('null', EXPECTED), /不是对象/);
});

test('parse_schemaVersion不支持_拒绝', () => {
  assert.throws(
    () => parseSyncUnitReceipt(JSON.stringify({ ...JSON.parse(VALID_APPLIED), schemaVersion: 2 }), EXPECTED),
    /schemaVersion/,
  );
});

test('parse_身份任一不匹配_拒绝', () => {
  const base = JSON.parse(VALID_APPLIED);
  assert.throws(
    () => parseSyncUnitReceipt(JSON.stringify({ ...base, operationId: 'op-other' }), EXPECTED),
    /operationId 不匹配/,
  );
  assert.throws(
    () => parseSyncUnitReceipt(JSON.stringify({ ...base, tool: 'claude' }), EXPECTED),
    /tool 不匹配/,
  );
  assert.throws(
    () => parseSyncUnitReceipt(JSON.stringify({ ...base, module: 'mcp' }), EXPECTED),
    /module 不匹配/,
  );
  assert.throws(
    () => parseSyncUnitReceipt(JSON.stringify({ ...base, scope: 'global' }), EXPECTED),
    /scope 不匹配/,
  );
});

test('parse_applied缺completedAt或时间非法或带reason_拒绝', () => {
  const base = JSON.parse(VALID_APPLIED);
  assert.throws(
    () => parseSyncUnitReceipt(JSON.stringify({ ...base, completedAt: undefined }), EXPECTED),
    /必须携带 completedAt/,
  );
  assert.throws(
    () => parseSyncUnitReceipt(JSON.stringify({ ...base, completedAt: '2026-10-16 06:00:00' }), EXPECTED),
    /UTC ISO 8601/,
  );
  assert.throws(
    () => parseSyncUnitReceipt(JSON.stringify({ ...base, completedAt: '2026-10-16T06:00:00+08:00' }), EXPECTED),
    /UTC ISO 8601/,
  );
  assert.throws(
    () => parseSyncUnitReceipt(JSON.stringify({ ...base, reasonCode: 'no_entries' }), EXPECTED),
    /不得携带 reasonCode/,
  );
});

test('parse_skipped或failed缺reason或带completedAt_拒绝', () => {
  const base = {
    schemaVersion: 1, operationId: 'op-123', tool: 'codex', module: 'rules', scope: 'project',
  };
  assert.throws(
    () => parseSyncUnitReceipt(JSON.stringify({ ...base, outcome: 'skipped' }), EXPECTED),
    /必须携带 reasonCode/,
  );
  assert.throws(
    () => parseSyncUnitReceipt(JSON.stringify({
      ...base, outcome: 'skipped', reasonCode: 'no_entries', completedAt: '2026-10-16T06:00:00Z',
    }), EXPECTED),
    /不得携带 completedAt/,
  );
  assert.throws(
    () => parseSyncUnitReceipt(JSON.stringify({ ...base, outcome: 'failed', completedAt: '2026-10-16T06:00:00Z' }), EXPECTED),
    /不得携带 completedAt/,
  );
});

test('parse_未知outcome_拒绝', () => {
  assert.throws(
    () => parseSyncUnitReceipt(JSON.stringify({ ...JSON.parse(VALID_APPLIED), outcome: 'partial' }), EXPECTED),
    /非法 outcome/,
  );
});

test('端到端_syncRun带回执_真实CLI写盘且校验通过', async () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'aiws-receipt-e2e-')));
  const aiws = path.join(root, '.ai-workspace');
  mkdirSync(path.join(aiws, 'rules'), { recursive: true });
  mkdirSync(path.join(aiws, 'config'), { recursive: true });
  cpSync(path.resolve(__dirname, '../../.ai-workspace/scripts'), path.join(aiws, 'scripts'), { recursive: true });
  writeFileSync(path.join(aiws, 'rules/00-core.md'), '---\nid: 00-core\ntitle: Core\nscope: all\n---\n# E2E\n');
  writeFileSync(path.join(aiws, 'config/workspace.json'), '{"version":"1.0","tools":["codex"],"default_scope":"project"}\n');

  const operationId = randomUUID();
  const reportFile = path.join(root, 'receipt.json');
  for await (const _line of syncRun(root, {
    libraryRoot: root,
    tool: 'codex',
    only: 'rules',
    scope: 'project',
    reportFile,
    operationId,
  })) { /* CLI 是唯一生成实现 */ }

  const receipt = parseSyncUnitReceipt(readFileSync(reportFile, 'utf8'), {
    operationId, tool: 'codex', module: 'rules', scope: 'project',
  });
  assert.strictEqual(receipt.outcome, 'applied');
  rmSync(root, { recursive: true, force: true });
});

test('syncRun_回执参数校验_缺配对或非绝对路径拒绝', async () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'aiws-receipt-args-')));
  await assert.rejects(
    async () => {
      for await (const _ of syncRun(root, { tool: 'codex', only: 'rules', scope: 'project', reportFile: path.join(root, 'r.json') })) { /* 不会到达 */ }
    },
    /reportFile 与 operationId 必须同时提供/,
  );
  await assert.rejects(
    async () => {
      for await (const _ of syncRun(root, {
        tool: 'codex', only: 'rules', scope: 'project',
        reportFile: 'rel.json', operationId: 'op-1',
      })) { /* 不会到达 */ }
    },
    /绝对路径/,
  );
  await assert.rejects(
    async () => {
      for await (const _ of syncRun(root, { reportFile: path.join(root, 'r.json'), operationId: 'op-1' })) { /* 不会到达 */ }
    },
    /tool、scope 与 only/,
  );
  rmSync(root, { recursive: true, force: true });
});
