// electron/test/rules.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listRules, setRuleRequired, ruleGlobs } from '../src/core/rules';

function makeWorkspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'aiws-rules-'));
  const aiws = path.join(root, '.ai-workspace');
  mkdirSync(path.join(aiws, 'rules', 'domains'), { recursive: true });
  mkdirSync(path.join(aiws, 'adapters', 'cursor'), { recursive: true });
  writeFileSync(path.join(aiws, 'rules', '00-core.md'), '---\nid: 00-core\ntitle: Core\nscope: all\n---\n# Core\n');
  writeFileSync(
    path.join(aiws, 'rules', 'domains', 'vue3.md'),
    '---\nid: vue3\ntitle: Vue3\nscope: vue\n---\n# Vue3\n'
  );
  writeFileSync(
    path.join(aiws, 'adapters', 'cursor', 'mapping.yaml'),
    'tool: cursor\nrules:\n  - source: rules/00-core.md\n    required: true\n  - source: rules/domains/vue3.md\n    required: false\n'
  );
  return root;
}

test('listRules 读取规则 + required 与 domain 标志', async () => {
  const root = makeWorkspace();
  const rules = await listRules(root);
  assert.strictEqual(rules.length, 2);
  const core = rules.find((r) => r.id === '00-core')!;
  assert.strictEqual(core.required, true);
  assert.strictEqual(core.domain, false);
  assert.strictEqual(core.scope, 'all');
  const vue = rules.find((r) => r.id === 'vue3')!;
  assert.strictEqual(vue.required, false);
  assert.strictEqual(vue.domain, true);
  assert.strictEqual(vue.globs, '**/*.{vue,ts,js,css,scss}');
});

test('setRuleRequired 切换 required 并回读', async () => {
  const root = makeWorkspace();
  await setRuleRequired(root, 'cursor', 'vue3', true, true);
  const rules = await listRules(root);
  assert.strictEqual(rules.find((r) => r.id === 'vue3')!.required, true);
});

test('ruleGlobs 优先级：frontmatter 行 > scope 默认', () => {
  assert.strictEqual(ruleGlobs('---\nglobs: "**/*.ts"\n---\n', 'all'), '**/*.ts');
  assert.strictEqual(ruleGlobs('---\nscope: csharp\n---\n', 'csharp'), '**/*.{cs,csproj,sln}');
  assert.strictEqual(ruleGlobs('---\n---\n', 'all'), '**/*');
});
