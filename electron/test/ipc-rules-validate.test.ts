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
