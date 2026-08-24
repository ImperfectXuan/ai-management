// electron/test/rules.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listRules, setRuleRequired, ruleGlobs } from '../src/core/rules';

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
