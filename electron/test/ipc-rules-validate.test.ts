// electron/test/ipc-rules-validate.test.ts
// 验证 IPC RulesSetRequired 入参校验（M6 修复）：
// - 缺字段 / 错类型 / 空字符串 / null / undefined / 非对象 → InvalidArgument
// - tool 非 PER_FILE_TOOLS 成员（claude/codex/任意字符串）→ UnsupportedTool
// - 合法入参原样返回
// 独立文件 import:validator 在 src/main/rules-args.ts,绕开 ipc.ts 顶层 electron 副作用。
import { test } from 'node:test';
import assert from 'node:assert';
import { validateRulesSetRequiredArgs } from '../src/main/rules-args';
import { ErrorCodes } from '../src/core/errors';

const valid = {
  repoId: 'repo-1',
  tool: 'cursor',
  id: '00-core',
  domain: false,
  value: true,
};

test('validateRulesSetRequiredArgs 合法入参原样返回', () => {
  const out = validateRulesSetRequiredArgs(valid);
  assert.deepStrictEqual(out, valid);
});

test('args 为 null 抛 InvalidArgument', () => {
  assert.throws(
    () => validateRulesSetRequiredArgs(null),
    (e: any) => e.code === ErrorCodes.InvalidArgument
  );
});

test('args 为 undefined 抛 InvalidArgument', () => {
  assert.throws(
    () => validateRulesSetRequiredArgs(undefined),
    (e: any) => e.code === ErrorCodes.InvalidArgument
  );
});

test('args 为原始类型抛 InvalidArgument', () => {
  assert.throws(
    () => validateRulesSetRequiredArgs('foo'),
    (e: any) => e.code === ErrorCodes.InvalidArgument
  );
  assert.throws(
    () => validateRulesSetRequiredArgs(42),
    (e: any) => e.code === ErrorCodes.InvalidArgument
  );
});

test('repoId 缺失/空字符串/非 string 抛 InvalidArgument', () => {
  for (const bad of [undefined, null, '', 42, {}]) {
    assert.throws(
      () => validateRulesSetRequiredArgs({ ...valid, repoId: bad }),
      (e: any) => e.code === ErrorCodes.InvalidArgument && /repoId/.test(e.message),
      `repoId=${JSON.stringify(bad)} 应抛 InvalidArgument`
    );
  }
});

test('id 缺失/空字符串抛 InvalidArgument', () => {
  assert.throws(
    () => validateRulesSetRequiredArgs({ ...valid, id: '' }),
    (e: any) => e.code === ErrorCodes.InvalidArgument && /id/.test(e.message)
  );
});

test('tool 非 PER_FILE_TOOLS 成员抛 UnsupportedTool（claude/codex/任意字符串）', () => {
  for (const bad of ['claude', 'codex', 'vscode', 'CURSOR', '', 'foo']) {
    assert.throws(
      () => validateRulesSetRequiredArgs({ ...valid, tool: bad }),
      (e: any) => e.code === ErrorCodes.UnsupportedTool,
      `tool=${JSON.stringify(bad)} 应抛 UnsupportedTool`
    );
  }
});

test('tool 非 string 抛 UnsupportedTool', () => {
  assert.throws(
    () => validateRulesSetRequiredArgs({ ...valid, tool: 42 }),
    (e: any) => e.code === ErrorCodes.UnsupportedTool
  );
});

test('domain 非 boolean 抛 InvalidArgument', () => {
  for (const bad of [undefined, null, 'false', 0, 1, 'true']) {
    assert.throws(
      () => validateRulesSetRequiredArgs({ ...valid, domain: bad }),
      (e: any) => e.code === ErrorCodes.InvalidArgument && /domain/.test(e.message),
      `domain=${JSON.stringify(bad)} 应抛 InvalidArgument`
    );
  }
});

test('value 非 boolean 抛 InvalidArgument', () => {
  for (const bad of [undefined, null, 'true', 0, 1]) {
    assert.throws(
      () => validateRulesSetRequiredArgs({ ...valid, value: bad }),
      (e: any) => e.code === ErrorCodes.InvalidArgument && /value/.test(e.message),
      `value=${JSON.stringify(bad)} 应抛 InvalidArgument`
    );
  }
});

test('trae 也是合法 tool', () => {
  const out = validateRulesSetRequiredArgs({ ...valid, tool: 'trae' });
  assert.strictEqual(out.tool, 'trae');
});

// ---------------------------------------------------------------------------
// desktop-rule-editor：RulesGet / RulesSave 入参校验
// ---------------------------------------------------------------------------

import { validateRulesGetArgs, validateRulesSaveArgs } from '../src/main/rules-args';

const validFields = {
  title: '核心原则',
  description: '',
  scope: 'all',
  globs: ['**/*.md'],
  tools: ['cursor'],
};

const validSave = {
  id: '00-core',
  domain: false,
  expectedVersion: 'sha256:abc',
  fields: validFields,
  body: '# 核心原则\n',
};

test('validateRulesGetArgs 合法入参原样返回', () => {
  assert.deepStrictEqual(validateRulesGetArgs({ id: '00-core', domain: true }), { id: '00-core', domain: true });
});

test('validateRulesGetArgs 拒绝缺失 id 与非 boolean domain', () => {
  for (const bad of [undefined, null, '', 42]) {
    assert.throws(
      () => validateRulesGetArgs({ id: bad, domain: false }),
      (e: any) => e.code === ErrorCodes.InvalidArgument && /id/.test(e.message)
    );
  }
  for (const bad of [undefined, null, 'false', 0, 1]) {
    assert.throws(
      () => validateRulesGetArgs({ id: '00-core', domain: bad }),
      (e: any) => e.code === ErrorCodes.InvalidArgument && /domain/.test(e.message)
    );
  }
});

test('validateRulesSaveArgs 合法入参原样返回并发允许空正文与空描述', () => {
  assert.deepStrictEqual(validateRulesSaveArgs(validSave), validSave);
  const out = validateRulesSaveArgs({ ...validSave, body: '', fields: { ...validFields, description: '' } });
  assert.strictEqual(out.body, '');
  assert.strictEqual(out.fields.description, '');
});

test('validateRulesSaveArgs 拒绝缺失字段与错误类型', () => {
  for (const field of ['id', 'domain', 'expectedVersion', 'fields', 'body'] as const) {
    const bad: Record<string, unknown> = { ...validSave };
    delete bad[field];
    assert.throws(
      () => validateRulesSaveArgs(bad),
      (e: any) => e.code === ErrorCodes.InvalidArgument,
      `缺少 ${field} 应失败`
    );
  }
  assert.throws(
    () => validateRulesSaveArgs({ ...validSave, fields: { ...validFields, title: 42 } }),
    (e: any) => e.code === ErrorCodes.InvalidArgument && /title/.test(e.message)
  );
  assert.throws(
    () => validateRulesSaveArgs({ ...validSave, fields: { ...validFields, globs: 'x' } }),
    (e: any) => e.code === ErrorCodes.InvalidArgument && /globs/.test(e.message)
  );
  assert.throws(
    () => validateRulesSaveArgs({ ...validSave, fields: { ...validFields, tools: [42] } }),
    (e: any) => e.code === ErrorCodes.InvalidArgument && /tools/.test(e.message)
  );
});

test('validateRulesSaveArgs 拒绝不支持的工具', () => {
  assert.throws(
    () => validateRulesSaveArgs({ ...validSave, fields: { ...validFields, tools: ['nvim'] } }),
    (e: any) => e.code === ErrorCodes.UnsupportedTool
  );
});

test('validateRulesSaveArgs 拒绝 null 与数组', () => {
  for (const bad of [null, undefined, [], 'x']) {
    assert.throws(
      () => validateRulesSaveArgs(bad),
      (e: any) => e.code === ErrorCodes.InvalidArgument
    );
  }
});
