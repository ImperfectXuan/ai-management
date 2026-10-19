// electron/test/rules.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listRules, setRuleRequired, ruleGlobs, ruleAppliesToTool } from '../src/core/rules';

function makeWorkspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'aiws-rules-'));
  const aiws = path.join(root, '.ai-workspace');
  mkdirSync(path.join(aiws, 'rules', 'domains'), { recursive: true });
  mkdirSync(path.join(aiws, 'adapters', 'cursor'), { recursive: true });
  mkdirSync(path.join(aiws, 'adapters', 'trae'), { recursive: true });
  writeFileSync(path.join(aiws, 'rules', '00-core.md'), '---\nid: 00-core\ntitle: Core\nscope: all\n---\n# Core\n');
  writeFileSync(
    path.join(aiws, 'rules', 'domains', 'vue3.md'),
    '---\nid: vue3\ntitle: Vue3\nscope: vue\n---\n# Vue3\n'
  );
  // cursor: 00-core=true, vue3=false
  writeFileSync(
    path.join(aiws, 'adapters', 'cursor', 'mapping.yaml'),
    'tool: cursor\nrules:\n  - source: rules/00-core.md\n    required: true\n  - source: rules/domains/vue3.md\n    required: false\n'
  );
  // trae: 00-core=false, vue3=true (与 cursor 相反,验证 per-tool 独立)
  writeFileSync(
    path.join(aiws, 'adapters', 'trae', 'mapping.yaml'),
    'tool: trae\nrules:\n  - source: rules/00-core.md\n    required: false\n  - source: rules/domains/vue3.md\n    required: true\n'
  );
  return root;
}

test('listRules 读取规则 + requiredByTool + domain 标志', async () => {
  const root = makeWorkspace();
  const rules = await listRules(root);
  assert.strictEqual(rules.length, 2);
  const core = rules.find((r) => r.id === '00-core')!;
  assert.strictEqual(core.requiredByTool.cursor, true);
  assert.strictEqual(core.requiredByTool.trae, false);
  assert.strictEqual(core.domain, false);
  assert.strictEqual(core.scope, 'all');
  const vue = rules.find((r) => r.id === 'vue3')!;
  assert.strictEqual(vue.requiredByTool.cursor, false);
  assert.strictEqual(vue.requiredByTool.trae, true);
  assert.strictEqual(vue.domain, true);
  assert.strictEqual(vue.globs, '**/*.{vue,ts,js,css,scss}');
});

test('listRules_versioningChangelog_isNotCountedAsRule', async () => {
  const root = makeWorkspace();
  writeFileSync(path.join(root, '.ai-workspace/rules/CHANGELOG.md'), '# 规则版本记录\n');

  const rules = await listRules(root);

  assert.deepStrictEqual(rules.map((rule) => rule.id).sort(), ['00-core', 'vue3']);
});

test('listRules cursor mapping 不存在时 requiredByTool.cursor 默认为 false', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'aiws-rules-noadapter-'));
  const aiws = path.join(root, '.ai-workspace');
  mkdirSync(path.join(aiws, 'rules'), { recursive: true });
  mkdirSync(path.join(aiws, 'rules', 'domains'), { recursive: true });
  // 不建 adapters 目录
  writeFileSync(path.join(aiws, 'rules', '00-core.md'), '---\nid: 00-core\nscope: all\n---\n# Core\n');
  const rules = await listRules(root);
  assert.strictEqual(rules[0].requiredByTool.cursor, false);
  assert.strictEqual(rules[0].requiredByTool.trae, false);
});

test('setRuleRequired 切换 required 并回读 (per-tool)', async () => {
  const root = makeWorkspace();
  await setRuleRequired(root, 'cursor', 'vue3', true, true);
  const rules = await listRules(root);
  const vue = rules.find((r) => r.id === 'vue3')!;
  // cursor 被改为 true
  assert.strictEqual(vue.requiredByTool.cursor, true);
  // trae 不受影响(仍为 true)
  assert.strictEqual(vue.requiredByTool.trae, true);
  // 写 trae 也不会影响 cursor
  await setRuleRequired(root, 'trae', 'vue3', true, false);
  const rules2 = await listRules(root);
  const vue2 = rules2.find((r) => r.id === 'vue3')!;
  assert.strictEqual(vue2.requiredByTool.trae, false);
  assert.strictEqual(vue2.requiredByTool.cursor, true, 'cursor 仍应是 true');
});

test('setRuleRequired 不会误命中兄弟文件 (foo.md vs foo.mdx)', async () => {
  const root = makeWorkspace();
  // 构造容易触发子串误命中的 mapping（foo.mdx 在前，foo.md 在后）
  writeFileSync(
    path.join(root, '.ai-workspace', 'adapters', 'cursor', 'mapping.yaml'),
    'tool: cursor\nrules:\n  - source: rules/foo.mdx\n    required: true\n  - source: rules/foo.md\n    required: true\n'
  );
  // 把 foo.md 的 required 改为 false
  await setRuleRequired(root, 'cursor', 'foo', false, false);
  // 直接读 mapping 验证：foo.md 应是 false，foo.mdx 应保持 true
  const updated = readFileSync(
    path.join(root, '.ai-workspace', 'adapters', 'cursor', 'mapping.yaml'),
    'utf8'
  );
  const fooMdxMatch = updated.match(/source: rules\/foo\.mdx\s*\n\s*required:\s*(\w+)/);
  const fooMatch = updated.match(/source: rules\/foo\.md\s*\n\s*required:\s*(\w+)/);
  assert.strictEqual(fooMatch?.[1], 'false', 'foo.md 应被改为 false');
  assert.strictEqual(fooMdxMatch?.[1], 'true', 'foo.mdx 不应被误改');
});

test('ruleGlobs 优先级：frontmatter 行 > scope 默认', () => {
  assert.strictEqual(ruleGlobs('---\nglobs: "**/*.ts"\n---\n', 'all'), '**/*.ts');
  assert.strictEqual(ruleGlobs('---\nscope: csharp\n---\n', 'csharp'), '**/*.{cs,csproj,sln}');
  assert.strictEqual(ruleGlobs('---\n---\n', 'all'), '**/*');
});

test('listRules 正文含 scope: 行不被误抓为 scope', async () => {
  const root = makeWorkspace();
  // 构造一个"陷阱"规则：frontmatter 写 scope: all，正文里举例写 scope: csharp
  writeFileSync(
    path.join(root, '.ai-workspace', 'rules', 'trap.md'),
    '---\nid: trap\ntitle: Trap\nscope: all\n---\n# Trap\n\n下面是个 YAML 示例：\n\n```yaml\nscope: csharp\nglobs: "**/*.cs"\n```\n'
  );
  const rules = await listRules(root);
  const trap = rules.find((r) => r.id === 'trap')!;
  assert.strictEqual(trap.scope, 'all', 'scope 应来自 frontmatter 而非正文代码块');
});

test('ruleGlobs 正文含 globs: 行不被误抓', () => {
  const content = [
    '---',
    'id: trap',
    'scope: all',
    '---',
    '# Trap',
    '',
    '示例代码：',
    '',
    '```yaml',
    'globs: "**/*.cs"',
    '```',
    '',
  ].join('\n');
  assert.strictEqual(ruleGlobs(content, 'all'), '**/*', '正文里的 globs: 行不应被采用');
});

test('listRules 解析 tools 字段（内联 / 块列表 / 缺省）', async () => {
  const root = makeWorkspace();
  const aiws = path.join(root, '.ai-workspace');
  writeFileSync(
    path.join(aiws, 'rules', 'inline.md'),
    '---\nid: inline\nscope: all\ntools: [cursor, trae]\n---\n# Inline\n'
  );
  writeFileSync(
    path.join(aiws, 'rules', 'block.md'),
    '---\nid: block\nscope: all\ntools:\n  - cursor\n  - trae\n---\n# Block\n'
  );
  const rules = await listRules(root);
  assert.deepStrictEqual(rules.find((r) => r.id === 'inline')!.tools, ['cursor', 'trae']);
  assert.deepStrictEqual(rules.find((r) => r.id === 'block')!.tools, ['cursor', 'trae']);
  // 缺省（00-core 无 tools 字段）→ 空数组 = 全工具
  assert.deepStrictEqual(rules.find((r) => r.id === '00-core')!.tools, []);
});

test('ruleAppliesToTool：空数组全工具，声明则按列表匹配', () => {
  const anyRule = (tools: string[]) => ({ tools } as { tools: string[] });
  assert.strictEqual(ruleAppliesToTool(anyRule([]), 'cursor'), true);
  assert.strictEqual(ruleAppliesToTool(anyRule(['cursor']), 'cursor'), true);
  assert.strictEqual(ruleAppliesToTool(anyRule(['cursor']), 'trae'), false);
  assert.strictEqual(ruleAppliesToTool(anyRule(['cursor', 'trae']), 'trae'), true);
});

// ---------------------------------------------------------------------------
// desktop-rule-editor：规则文档读取与保存
// ---------------------------------------------------------------------------

import { chmodSync, cpSync, readdirSync, rmSync } from 'node:fs';
import { listRules as listRulesForEditor, readRuleDocument, saveRule } from '../src/core/rules';
import type { RuleFields } from '../src/core/rules';

function makeEditorWorkspace() {
  const root = makeWorkspace();
  writeFileSync(
    path.join(root, '.ai-workspace/rules/01-style.md'),
    '---\nid: 01-style\ntitle: "样式 & 结构"\nscope: all\ndescription: 代码风格\nglobs:\n  - "**/*.ts"\n  - "**/*.tsx"\ncustom-key: keep-me\ntools: [cursor, trae]\n---\n\n# 样式\n\n- 第一项\n'
  );
  return root;
}

function fieldsOf(overrides: Partial<RuleFields> = {}): RuleFields {
  return {
    title: '核心规则',
    description: '描述',
    scope: 'all',
    globs: [],
    tools: [],
    ...overrides,
  };
}

test('readRuleDocument 解析普通规则与领域规则', async () => {
  const root = makeEditorWorkspace();

  const core = await readRuleDocument(root, '00-core', false);
  const style = await readRuleDocument(root, '01-style', false);
  const vue = await readRuleDocument(root, 'vue3', true);

  assert.strictEqual(core.relativePath, 'rules/00-core.md');
  assert.strictEqual(core.fields.title, 'Core');
  assert.strictEqual(core.fields.scope, 'all');
  assert.ok(core.version.startsWith('sha256:'));
  assert.match(core.body, /^# Core/);

  assert.strictEqual(style.fields.title, '样式 & 结构');
  assert.strictEqual(style.fields.description, '代码风格');
  assert.deepStrictEqual(style.fields.globs, ['**/*.ts', '**/*.tsx']);
  assert.deepStrictEqual(style.fields.tools, ['cursor', 'trae']);

  assert.strictEqual(vue.relativePath, 'rules/domains/vue3.md');
  assert.strictEqual(vue.domain, true);
});

test('saveRule 未修改字段时保留原始键行与未知键', async () => {
  const root = makeEditorWorkspace();
  const before = await readRuleDocument(root, '01-style', false);

  await saveRule(root, {
    id: '01-style',
    domain: false,
    expectedVersion: before.version,
    fields: before.fields,
    body: before.body,
  });

  const saved = readFileSync(path.join(root, '.ai-workspace/rules/01-style.md'), 'utf8');
  assert.match(saved, /^---\nid: 01-style\n/);
  assert.match(saved, /title: "样式 & 结构"/);
  assert.match(saved, /custom-key: keep-me/);
  assert.match(saved, /tools: \[cursor, trae\]/);
  assert.match(saved, /- 第一项/);
});

test('saveRule 只重写被编辑的字段并保留未知键', async () => {
  const root = makeEditorWorkspace();
  const before = await readRuleDocument(root, '01-style', false);

  await saveRule(root, {
    id: '01-style',
    domain: false,
    expectedVersion: before.version,
    fields: { ...before.fields, title: '新的标题', globs: ['**/*.ts'] },
    body: '# 样式\n\n- 修改后的第一项\n',
  });

  const after = await readRuleDocument(root, '01-style', false);
  assert.strictEqual(after.fields.title, '新的标题');
  assert.deepStrictEqual(after.fields.globs, ['**/*.ts']);
  assert.strictEqual(after.fields.description, '代码风格');
  assert.deepStrictEqual(after.fields.tools, ['cursor', 'trae']);
  assert.match(after.body, /修改后的第一项/);
  const saved = readFileSync(path.join(root, '.ai-workspace/rules/01-style.md'), 'utf8');
  assert.match(saved, /custom-key: keep-me/);
  assert.match(saved, /id: 01-style/);
});

test('saveRule 校验非法字段', async () => {
  const root = makeEditorWorkspace();
  const before = await readRuleDocument(root, '00-core', false);
  const base = { id: '00-core', domain: false, expectedVersion: before.version, body: before.body };

  await assert.rejects(
    saveRule(root, { ...base, fields: fieldsOf({ scope: 'Bad Scope' }) }),
    /scope/
  );
  await assert.rejects(
    saveRule(root, { ...base, fields: fieldsOf({ title: '' }) }),
    /title/
  );
  await assert.rejects(
    saveRule(root, { ...base, fields: fieldsOf({ globs: [''] }) }),
    /globs/
  );
  await assert.rejects(
    saveRule(root, { ...base, fields: fieldsOf({ tools: ['nvim' as never] }) }),
    /tools/
  );
  await assert.rejects(
    saveRule(root, { ...base, fields: fieldsOf({ title: 'a\nb' }) }),
    /换行/
  );
});

test('saveRule 拒绝目录穿越与不存在的规则', async () => {
  const root = makeEditorWorkspace();
  const fields = fieldsOf();
  await assert.rejects(
    saveRule(root, { id: '../escape', domain: false, expectedVersion: 'sha256:x', fields, body: '' }),
    /非法规则 id/
  );
  await assert.rejects(
    saveRule(root, { id: 'missing', domain: false, expectedVersion: 'sha256:x', fields, body: '' }),
    /规则不存在/
  );
  assert.strictEqual(readdirSync(path.join(root, '.ai-workspace/rules')).includes('missing.md'), false);
});

test('saveRule 检测外部修改并保留外部内容', async () => {
  const root = makeEditorWorkspace();
  const before = await readRuleDocument(root, '00-core', false);
  const file = path.join(root, '.ai-workspace/rules/00-core.md');
  writeFileSync(file, '---\nid: 00-core\ntitle: 外部\ndescription: x\n---\n\n# 外部修改\n');

  await assert.rejects(
    saveRule(root, {
      id: '00-core',
      domain: false,
      expectedVersion: before.version,
      fields: fieldsOf(),
      body: '# Desktop',
    }),
    /已被外部修改/
  );
  assert.match(readFileSync(file, 'utf8'), /# 外部修改/);
});

test('saveRule 写入失败时保留原文件', async () => {
  const root = makeEditorWorkspace();
  const before = await readRuleDocument(root, '00-core', false);
  const dir = path.join(root, '.ai-workspace/rules');
  chmodSync(dir, 0o500);
  try {
    await assert.rejects(
      saveRule(root, {
        id: '00-core',
        domain: false,
        expectedVersion: before.version,
        fields: fieldsOf(),
        body: '# changed',
      }),
      /保存规则失败/
    );
  } finally {
    chmodSync(dir, 0o700);
  }
  assert.match(readFileSync(path.join(dir, '00-core.md'), 'utf8'), /# Core/);
});

test('saveRule 对现有规则做加载→不改→保存后文字内容不变', async () => {
  const source = path.resolve(__dirname, '../../.ai-workspace/rules');
  const root = mkdtempSync(path.join(tmpdir(), 'aiws-rules-fixture-'));
  cpSync(source, path.join(root, '.ai-workspace/rules'), { recursive: true });
  const files = readdirSync(path.join(root, '.ai-workspace/rules'))
    .filter((file) => file.endsWith('.md') && file !== 'CHANGELOG.md');

  for (const file of files) {
    const id = file.replace(/\.md$/, '');
    const before = await readRuleDocument(root, id, false);
    await saveRule(root, {
      id,
      domain: false,
      expectedVersion: before.version,
      fields: before.fields,
      body: before.body,
    });
    const after = await readRuleDocument(root, id, false);
    assert.deepStrictEqual(after.fields, before.fields, `${id} 字段不应变化`);
    assert.deepStrictEqual(after.body, before.body, `${id} 正文不应变化`);
  }

  rmSync(root, { recursive: true, force: true });
});

test('listRules 返回 title 供列表显示', async () => {
  const root = makeEditorWorkspace();
  const rules = await listRulesForEditor(root);
  const style = rules.find((rule) => rule.id === '01-style');
  assert.strictEqual(style?.title, '样式 & 结构');
});
