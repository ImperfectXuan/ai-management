// electron/test/sync-fingerprint.test.ts
// 功能 002：密钥派生 keyId 与 HMAC 指纹的行为测试（design §3.1、§2.3）。
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, statSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  KEY_BYTES,
  canonicalJson,
  checkKeyFile,
  computeEffectiveOutputFingerprint,
  computeSourceFingerprint,
  createKeyFile,
  deriveKeyId,
  hmacSha256,
} from '../src/core/sync-fingerprint';

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'aiws-fingerprint-'));
}

test('deriveKeyId_相同密钥_返回相同格式身份', () => {
  const key = randomBytes(KEY_BYTES);
  const keyId = deriveKeyId(key);
  assert.match(keyId, /^sha256:[0-9a-f]{64}$/);
  assert.strictEqual(deriveKeyId(key), keyId);
  assert.notStrictEqual(deriveKeyId(randomBytes(KEY_BYTES)), keyId);
});

test('deriveKeyId_长度不是32字节_快速失败', () => {
  assert.throws(() => deriveKeyId(randomBytes(16)), /长度必须为 32 字节/);
});

test('checkKeyFile_密钥不存在_报告missing且不创建文件', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'sync-fingerprint.key');
  const result = await checkKeyFile(file);
  assert.deepStrictEqual(result, { status: 'missing' });
  assert.strictEqual(existsSync(file), false, '查询不得生成密钥文件');
  rmSync(dir, { recursive: true, force: true });
});

test('checkKeyFile_长度无效_报告invalid', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'sync-fingerprint.key');
  writeFileSync(file, randomBytes(16));
  const result = await checkKeyFile(file);
  assert.deepStrictEqual(result, { status: 'invalid' });
  rmSync(dir, { recursive: true, force: true });
});

test('createKeyFile_首次显式调用_创建32字节且权限0600', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'nested', 'sync-fingerprint.key');
  const created = await createKeyFile(file);
  assert.strictEqual(readFileSync(file).length, KEY_BYTES);
  assert.strictEqual(statSync(file).mode & 0o777, 0o600);
  assert.strictEqual(created.keyId, deriveKeyId(readFileSync(file)));
  rmSync(dir, { recursive: true, force: true });
});

test('createKeyFile_已有密钥_不原位替换', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'sync-fingerprint.key');
  const first = await createKeyFile(file);
  const bytesBefore = readFileSync(file);
  const second = await createKeyFile(file);
  assert.strictEqual(second.keyId, first.keyId);
  assert.deepStrictEqual(readFileSync(file), bytesBefore, '已有密钥必须原样保留');
  rmSync(dir, { recursive: true, force: true });
});

test('createKeyFile_已有无效长度密钥_拒绝覆盖', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'sync-fingerprint.key');
  writeFileSync(file, randomBytes(8));
  await assert.rejects(() => createKeyFile(file), /长度无效/);
  assert.strictEqual(readFileSync(file).length, 8, '无效旧密钥不被静默替换');
  rmSync(dir, { recursive: true, force: true });
});

test('canonicalJson_对象键插入顺序不同_输出一致且按字节序排列', () => {
  const a = canonicalJson({ B: 1, a: { x: 1, y: 2 }, nested: null });
  const b = canonicalJson({ nested: null, a: { y: 2, x: 1 }, B: 1 });
  assert.strictEqual(a, b);
  assert.ok(a.indexOf('"B"') < a.indexOf('"a"'), '键须按 UTF-8 字节序（B < a）排列');
});

test('canonicalJson_数组顺序不同_输出不同', () => {
  assert.notStrictEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
});

test('canonicalJson_非有限数字与不可序列化类型_快速失败', () => {
  assert.throws(() => canonicalJson({ value: Number.NaN }), /非有限数字/);
  assert.throws(() => canonicalJson({ value: () => undefined }), /不可序列化/);
});

test('hmacSha256_密钥不同_结果不同；相同密钥与载荷确定一致', () => {
  const payload = { fingerprintVersion: 1, payload: { inputs: ['a', 'b'] } };
  const key = randomBytes(KEY_BYTES);
  assert.strictEqual(hmacSha256(key, payload), hmacSha256(key, payload));
  assert.notStrictEqual(hmacSha256(key, payload), hmacSha256(randomBytes(KEY_BYTES), payload));
  assert.notStrictEqual(hmacSha256(key, payload), hmacSha256(key, { fingerprintVersion: 1, payload: { inputs: ['a', 'c'] } }));
});

test('computeSourceFingerprint_载荷含工具身份_不同工具结果不同', () => {
  const key = randomBytes(KEY_BYTES);
  const base = {
    inputs: { skills: [{ name: 'alpha', hash: 'aa' }] },
    behavior: { linkType: 'symlink' },
    generatorDeps: { 'skills-link.sh': 'rev1' },
  };
  const codex = computeSourceFingerprint(key, { unit: { tool: 'codex', module: 'skills', scope: 'project' }, ...base });
  const claude = computeSourceFingerprint(key, { unit: { tool: 'claude', module: 'skills', scope: 'project' }, ...base });
  assert.match(codex, /^[0-9a-f]{64}$/);
  assert.notStrictEqual(codex, claude, '来源指纹含 tool，不得用于跨工具等价判定');
  const changed = computeSourceFingerprint(key, {
    unit: { tool: 'codex', module: 'skills', scope: 'project' },
    ...base,
    inputs: { skills: [{ name: 'alpha', hash: 'bb' }] },
  });
  assert.notStrictEqual(codex, changed, '输入内容变化必须改变指纹');
});

test('computeEffectiveOutputFingerprint_条目与输出键顺序不同_结果相同', () => {
  const key = randomBytes(KEY_BYTES);
  const planA = {
    outputKeys: ['/p/.agents/skills', '/p/.cursor/skills'],
    entries: [
      { relativePath: 'beta', targetPath: '/p/.agents/skills/beta', sourcePath: '/lib/skills/beta', sourceVersion: 'sha-v1', strategy: 'symlink' as const },
      { relativePath: 'alpha', targetPath: '/p/.agents/skills/alpha', sourcePath: '/lib/skills/alpha', sourceVersion: 'sha-v2', strategy: 'symlink' as const },
    ],
    behavior: { linkType: 'auto' },
  };
  const planB = {
    outputKeys: ['/p/.cursor/skills', '/p/.agents/skills'],
    entries: [...planA.entries].reverse(),
    behavior: { linkType: 'auto' },
  };
  assert.strictEqual(
    computeEffectiveOutputFingerprint(key, planA),
    computeEffectiveOutputFingerprint(key, planB),
    '枚举顺序不得影响有效输出指纹'
  );
});

test('computeEffectiveOutputFingerprint_影响落盘结果的字段变化_指纹随之变化', () => {
  const key = randomBytes(KEY_BYTES);
  const plan = {
    outputKeys: ['/p/.agents/skills'],
    entries: [
      { relativePath: 'alpha', targetPath: '/p/.agents/skills/alpha', sourcePath: '/lib/skills/alpha', sourceVersion: 'sha-v2', strategy: 'symlink' as const },
    ],
    behavior: { linkType: 'auto' },
  };
  const base = computeEffectiveOutputFingerprint(key, plan);
  const variants = [
    { ...plan, outputKeys: ['/p/.agents/skills', '/p/extra'] },
    { ...plan, entries: [{ ...plan.entries[0], sourceVersion: 'sha-v3' }] },
    { ...plan, entries: [{ ...plan.entries[0], strategy: 'copy' as const }] },
    { ...plan, entries: [{ ...plan.entries[0], targetPath: '/p/other/skills/alpha' }] },
    { ...plan, entries: [{ ...plan.entries[0], sourcePath: '/lib/skills/renamed' }] },
    { ...plan, behavior: { linkType: 'copy' } },
    { ...plan, entries: [{ ...plan.entries[0], relativePath: 'gamma', targetPath: '/p/.agents/skills/gamma', sourcePath: '/lib/skills/gamma' }] },
  ];
  for (const variant of variants) {
    assert.notStrictEqual(computeEffectiveOutputFingerprint(key, variant), base);
  }
  assert.strictEqual(computeEffectiveOutputFingerprint(key, plan), base, '相同计划必须确定一致');
});

test('computeEffectiveOutputFingerprint_无效计划字段_快速失败', () => {
  const key = randomBytes(KEY_BYTES);
  assert.throws(
    () =>
      computeEffectiveOutputFingerprint(key, {
        outputKeys: ['/p/.agents/skills'],
        entries: [
          { relativePath: '', targetPath: '/t', sourcePath: '/s', sourceVersion: 'v', strategy: 'symlink' },
        ],
        behavior: {},
      }),
    /分发计划字段无效/
  );
  assert.throws(
    () =>
      computeEffectiveOutputFingerprint(key, {
        outputKeys: ['/p/.agents/skills'],
        entries: [
          { relativePath: 'a', targetPath: '/t', sourcePath: '/s', sourceVersion: 'v', strategy: 'rsync' },
        ],
        behavior: {},
      } as unknown as Parameters<typeof computeEffectiveOutputFingerprint>[1]),
    /分发策略无效/
  );
});
