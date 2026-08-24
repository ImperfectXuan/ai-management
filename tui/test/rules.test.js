// tui/test/rules.test.js
// 验证 setRequired 的失败分流(M8 静默失败修复):
// - 成功路径返回 { ok: true } 并写入 mapping
// - 三种失败路径返回 { ok: false, code, error }
// M12 修复后:只需在 before 中 chdir 到 tmp git 仓库,无需清 require 缓存,
// 因为 getRoot() 已被改成懒求值。
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');

let rulesLib;
let tmpRoot;
let originalCwd;

before(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'aiws-tui-rules-'));
  execSync('git init -q', { cwd: tmpRoot });
  const aiws = path.join(tmpRoot, '.ai-workspace');
  mkdirSync(path.join(aiws, 'rules', 'domains'), { recursive: true });
  mkdirSync(path.join(aiws, 'adapters', 'cursor'), { recursive: true });
  // 真实规则文件:listRules 扫描这些文件,缺失时返回空数组
  writeFileSync(
    path.join(aiws, 'rules', '00-core.md'),
    '---\nid: 00-core\ntitle: Core\nscope: all\n---\n# Core\n'
  );
  writeFileSync(
    path.join(aiws, 'rules', 'domains', 'vue3.md'),
    '---\nid: vue3\ntitle: Vue3\nscope: vue\nglobs: **/*.{vue,ts,js,css,scss}\n---\n# Vue3\n'
  );
  writeFileSync(
    path.join(aiws, 'adapters', 'cursor', 'mapping.yaml'),
    [
      'tool: cursor',
      'rules:',
      '  - source: rules/00-core.md',
      '    required: true',
      '  - source: rules/domains/vue3.md',
      '    required: false',
      '',
    ].join('\n')
  );
  originalCwd = process.cwd();
  mkdirSync(path.join(tmpRoot, '.ai-workspace', 'adapters', 'trae'), { recursive: true });
  writeFileSync(
    path.join(tmpRoot, '.ai-workspace', 'adapters', 'trae', 'mapping.yaml'),
    [
      'tool: trae',
      'rules:',
      '  - source: rules/00-core.md',
      '    required: false',
      '  - source: rules/domains/vue3.md',
      '    required: true',
      '',
    ].join('\n')
  );
  process.chdir(tmpRoot);
  // M12 修复后:此处不再需要 delete require.cache;getRoot() 已在调用时才执行
  rulesLib = require('../src/lib/rules.js');
});

after(() => {
  process.chdir(originalCwd);
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

const mappingFile = () => path.join(tmpRoot, '.ai-workspace', 'adapters', 'cursor', 'mapping.yaml');

test('setRequired 成功路径返回 { ok: true } 并改写 mapping', () => {
  const result = rulesLib.setRequired('00-core', false, false);
  assert.deepStrictEqual(result, { ok: true });
  const map = readFileSync(mappingFile(), 'utf8');
  // 写入: required: false
  assert.match(map, /source: rules\/00-core\.md\s*\n\s*required: false/);
});

test('setRequired source 不在 mapping 时返回 SourceNotInMapping', () => {
  const result = rulesLib.setRequired('ghost-rule', false, true);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'SourceNotInMapping');
  assert.match(result.error, /ghost-rule/);
});

test('setRequired mapping 文件不存在时返回 MappingMissing', () => {
  rmSync(mappingFile());
  const result = rulesLib.setRequired('00-core', false, true);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'MappingMissing');
  assert.match(result.error, /mapping 文件不存在/);
});

test('setRequired 成功后 mapping 中其它条目不受影响', () => {
  // 先恢复 mapping(被上一个 case 删了)
  writeFileSync(
    mappingFile(),
    [
      'tool: cursor',
      'rules:',
      '  - source: rules/00-core.md',
      '    required: true',
      '  - source: rules/domains/vue3.md',
      '    required: false',
      '',
    ].join('\n')
  );
  const result = rulesLib.setRequired('00-core', false, false);
  assert.deepStrictEqual(result, { ok: true });
  const map = readFileSync(mappingFile(), 'utf8');
  // 00-core 被改写为 false
  assert.match(map, /source: rules\/00-core\.md\s*\n\s*required: false/);
  // vue3 条目保持 false
  const vue3 = map.match(/source: rules\/domains\/vue3\.md\s*\n\s*required:\s*(\w+)/);
  assert.strictEqual(vue3?.[1], 'false', 'vue3 不应被误改');
});

test('listRules 读 per-tool requiredByTool: cursor=true trae=false (00-core)', () => {
  // 重新建完整工作区,确保 cursor/trae 两个 mapping 都在
  rmSync(mappingFile());
  writeFileSync(
    mappingFile(),
    [
      'tool: cursor',
      'rules:',
      '  - source: rules/00-core.md',
      '    required: true',
      '  - source: rules/domains/vue3.md',
      '    required: false',
      '',
    ].join('\n')
  );
  writeFileSync(
    path.join(tmpRoot, '.ai-workspace', 'adapters', 'trae', 'mapping.yaml'),
    [
      'tool: trae',
      'rules:',
      '  - source: rules/00-core.md',
      '    required: false',
      '  - source: rules/domains/vue3.md',
      '    required: true',
      '',
    ].join('\n')
  );
  const rules = rulesLib.listRules();
  const core = rules.find((r) => r.id === '00-core');
  assert.ok(core, '应能找到 00-core');
  assert.strictEqual(core.requiredByTool.cursor, true);
  assert.strictEqual(core.requiredByTool.trae, false);
  const vue = rules.find((r) => r.id === 'vue3');
  assert.ok(vue, '应能找到 vue3');
  assert.strictEqual(vue.requiredByTool.cursor, false);
  assert.strictEqual(vue.requiredByTool.trae, true);
});

test('setRequired 传 tool 参数: trae 时只改 trae mapping,不动 cursor', () => {
  // 恢复两个 mapping
  writeFileSync(
    mappingFile(),
    [
      'tool: cursor',
      'rules:',
      '  - source: rules/00-core.md',
      '    required: true',
      '',
    ].join('\n')
  );
  writeFileSync(
    path.join(tmpRoot, '.ai-workspace', 'adapters', 'trae', 'mapping.yaml'),
    [
      'tool: trae',
      'rules:',
      '  - source: rules/00-core.md',
      '    required: true',
      '',
    ].join('\n')
  );
  // 改 trae 下的 00-core 为 false
  const result = rulesLib.setRequired('00-core', false, false, 'trae');
  assert.deepStrictEqual(result, { ok: true });
  const cursorMap = readFileSync(mappingFile(), 'utf8');
  const traeMap = readFileSync(
    path.join(tmpRoot, '.ai-workspace', 'adapters', 'trae', 'mapping.yaml'),
    'utf8'
  );
  // cursor 应保持 true
  assert.match(cursorMap, /source: rules\/00-core\.md\s*\n\s*required: true/);
  // trae 应被改为 false
  assert.match(traeMap, /source: rules\/00-core\.md\s*\n\s*required: false/);
});

// ===== M2(a) CRLF 兼容 =====

test('listRules 在 CRLF mapping 下仍能正确读出 required', () => {
  // 写一个 CRLF 结尾的 cursor mapping（模拟 git autocrlf / Windows 编辑器）
  writeFileSync(
    mappingFile(),
    [
      'tool: cursor',
      'rules:',
      '  - source: rules/00-core.md',
      '    required: true',
      '  - source: rules/domains/vue3.md',
      '    required: false',
      '',
    ].join('\r\n')
  );
  const rules = rulesLib.listRules();
  const core = rules.find((r) => r.id === '00-core');
  assert.ok(core, 'CRLF 文件下也应能找到 00-core');
  assert.strictEqual(core.requiredByTool.cursor, true);
  const vue = rules.find((r) => r.id === 'vue3');
  assert.ok(vue);
  assert.strictEqual(vue.requiredByTool.cursor, false);
});

test('setRequired 能改写 CRLF mapping 文件,改完行尾仍是 CRLF 还是 LF 不退化', () => {
  writeFileSync(
    mappingFile(),
    [
      'tool: cursor',
      'rules:',
      '  - source: rules/00-core.md',
      '    required: true',
      '',
    ].join('\r\n')
  );
  const result = rulesLib.setRequired('00-core', false, false);
  assert.deepStrictEqual(result, { ok: true });
  const after = readFileSync(mappingFile(), 'utf8');
  // 改写后行尾被归一为 LF（避免混合行尾污染仓库）
  assert.ok(!after.includes('\r\n'), '改写后应统一为 LF,不再保留 CRLF');
  assert.match(after, /source: rules\/00-core\.md\s*\n\s*required: false/);
});

// ===== M2(b) 循环读 — setRequiredBatch 共享一次 IO =====

test('setRequiredBatch 一次 read+write 完成多条修改,applied 列出全部', () => {
  writeFileSync(
    mappingFile(),
    [
      'tool: cursor',
      'rules:',
      '  - source: rules/00-core.md',
      '    required: true',
      '  - source: rules/domains/vue3.md',
      '    required: false',
      '',
    ].join('\n')
  );
  const result = rulesLib.setRequiredBatch(
    [
      { id: '00-core', domain: false, value: false },
      { id: 'vue3', domain: true, value: true },
    ],
    'cursor'
  );
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.applied, [
    { id: '00-core', value: false },
    { id: 'vue3', value: true },
  ]);
  const after = readFileSync(mappingFile(), 'utf8');
  assert.match(after, /source: rules\/00-core\.md\s*\n\s*required: false/);
  assert.match(after, /source: rules\/domains\/vue3\.md\s*\n\s*required: true/);
});

test('setRequiredBatch 中某条失败时整批不写入,applied 列出已逻辑成功项', () => {
  writeFileSync(
    mappingFile(),
    [
      'tool: cursor',
      'rules:',
      '  - source: rules/00-core.md',
      '    required: true',
      '',
    ].join('\n')
  );
  // 第一条改 false（应成功），第二条 vue3 不在 mapping 中（应失败）
  const result = rulesLib.setRequiredBatch(
    [
      { id: '00-core', domain: false, value: false },
      { id: 'vue3', domain: true, value: true },
    ],
    'cursor'
  );
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'SourceNotInMapping');
  // 失败时已逻辑成功项要回传,便于上层做部分成功 UI 提示
  assert.deepStrictEqual(result.applied, [{ id: '00-core', value: false }]);
  // batch 语义:全成功才一次写盘;中途失败则整批不写,文件保持原样
  const after = readFileSync(mappingFile(), 'utf8');
  assert.match(after, /source: rules\/00-core\.md\s*\n\s*required: true/);
});

test('setRequiredBatch mapping 缺失时返回 MappingMissing,不做 IO', () => {
  rmSync(mappingFile());
  const result = rulesLib.setRequiredBatch(
    [{ id: '00-core', domain: false, value: false }],
    'cursor'
  );
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'MappingMissing');
});

test('listRules 正文里的 scope/globs 示例不应覆盖 frontmatter', () => {
  writeFileSync(
    path.join(tmpRoot, '.ai-workspace', 'rules', 'trap.md'),
    [
      '---',
      'id: trap',
      'title: Trap',
      'scope: all',
      '---',
      '# Trap',
      '',
      '```yaml',
      'scope: csharp',
      'globs: "**/*.cs"',
      '```',
      '',
    ].join('\n')
  );

  const rules = rulesLib.listRules();
  const trap = rules.find((r) => r.id === 'trap');

  assert.ok(trap, '应能找到 trap');
  assert.strictEqual(trap.scope, 'all', 'scope 应来自 frontmatter');
  assert.strictEqual(trap.globs, '**/*', '正文里的 globs 示例不应被误抓');
});
