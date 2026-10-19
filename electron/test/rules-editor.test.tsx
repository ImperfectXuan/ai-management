// electron/test/rules-editor.test.tsx
// 加载顺序：react-dom 必须在 jsdom 全局就绪后再加载，否则受控输入的 onChange 不触发。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type TL = typeof import('@testing-library/react');
type PageModule = typeof import('../src/renderer/pages/rules');
type EditorModule = typeof import('../src/renderer/pages/rule-editor');

let tlCache: TL | null = null;
let pageCache: PageModule | null = null;
let editorCache: EditorModule | null = null;

async function libs(): Promise<TL> {
  if (!tlCache) tlCache = await import('@testing-library/react');
  return tlCache;
}
async function pageModule(): Promise<PageModule> {
  if (!pageCache) pageCache = await import('../src/renderer/pages/rules');
  return pageCache;
}
async function editorModule(): Promise<EditorModule> {
  if (!editorCache) editorCache = await import('../src/renderer/pages/rule-editor');
  return editorCache;
}

interface FakeEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

function FakeBodyEditor({ value, onChange }: FakeEditorProps) {
  return (
    <textarea
      aria-label="正文"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

interface Doc {
  id: string;
  domain: boolean;
  relativePath: string;
  version: string;
  fields: { title: string; description: string; scope: string; globs: string[]; tools: string[] };
  body: string;
}

function makeDocs(): Record<string, Doc> {
  return {
    '00-core': {
      id: '00-core',
      domain: false,
      relativePath: 'rules/00-core.md',
      version: 'sha256:1',
      fields: { title: '核心原则', description: '原则描述', scope: 'all', globs: [], tools: [] },
      body: '# 核心原则\n\n- 第一条\n',
    },
    vue3: {
      id: 'vue3',
      domain: true,
      relativePath: 'rules/domains/vue3.md',
      version: 'sha256:2',
      fields: { title: 'Vue 3 规范', description: '', scope: 'vue', globs: ['**/*.vue'], tools: ['cursor'] },
      body: '# Vue 3\n\n- 组合式 API\n',
    },
  };
}

const ruleList = [
  { id: '00-core', title: '核心原则', scope: 'all', globs: '**/*', requiredByTool: { cursor: true, trae: false }, domain: false, tools: [] },
  { id: 'vue3', title: 'Vue 3 规范', scope: 'vue', globs: '**/*.{vue,ts}', requiredByTool: { cursor: false, trae: true }, domain: true, tools: ['cursor'] },
];

let handlers: Record<string, (payload?: any) => any> = {};
let calls: Array<{ channel: string; payload: any }> = [];
let docs: Record<string, Doc> = {};

beforeEach(async () => {
  const { cleanup } = await libs();
  cleanup();
  docs = makeDocs();
  calls = [];
  handlers = {
    'rules:list': () => ruleList,
    'rules:get': (payload) => docs[payload.id],
    'rules:save': (payload) => {
      const previous = docs[payload.id];
      docs[payload.id] = { ...previous, version: 'sha256:next', fields: payload.fields, body: payload.body };
      return { version: 'sha256:next' };
    },
    'rules:setRequired': () => null,
    'sync:run': () => null,
  };
  (globalThis as any).window.api = {
    invoke: async (channel: string, payload?: unknown) => {
      calls.push({ channel, payload });
      try {
        return { ok: true, data: handlers[channel]?.(payload) };
      } catch (error) {
        return { ok: false, message: (error as Error).message };
      }
    },
    on: () => () => {},
  };
});

test('rules page 列表显示 title，选中后加载全文与只读 id', async () => {
  const { render, within } = await libs();
  const { RulesPage } = await pageModule();
  const { container } = render(<RulesPage repoId="repo-1" BodyEditor={FakeBodyEditor} />);
  const q = within(container);

  assert.ok((await q.findAllByText('核心原则')).length >= 1);
  assert.ok(q.getByRole('button', { name: /核心原则/ }));

  const idInput = await q.findByLabelText('规则 id') as HTMLInputElement;
  assert.strictEqual(idInput.value, '00-core');
  assert.strictEqual(idInput.disabled, true);
  assert.strictEqual((q.getByLabelText('标题') as HTMLInputElement).value, '核心原则');
  assert.strictEqual((q.getByLabelText('正文') as HTMLTextAreaElement).value, '# 核心原则\n\n- 第一条\n');
});

test('编辑正文后保存，提交预期字段并提示待同步', async () => {
  const { render, within, fireEvent } = await libs();
  const { RulesPage } = await pageModule();
  const { container } = render(<RulesPage repoId="repo-1" BodyEditor={FakeBodyEditor} />);
  const q = within(container);

  fireEvent.change(await q.findByLabelText('标题'), { target: { value: '核心原则（修订）' } });
  fireEvent.change(q.getByLabelText('正文'), { target: { value: '# 修订\n\n- 新内容\n' } });
  fireEvent.click(q.getByRole('button', { name: '保存' }));

  assert.ok(await q.findByText('已保存；规则等待同步'));
  const save = calls.find((call) => call.channel === 'rules:save');
  assert.ok(save);
  assert.strictEqual(save?.payload.expectedVersion, 'sha256:1');
  assert.strictEqual(save?.payload.fields.title, '核心原则（修订）');
  assert.strictEqual(save?.payload.body, '# 修订\n\n- 新内容\n');
});

test('保存冲突时显示错误并提供重新加载', async () => {
  const { render, within, fireEvent } = await libs();
  const { RulesPage } = await pageModule();
  handlers['rules:save'] = () => { throw new Error('规则文件已被外部修改：rules/00-core.md；请重新加载后再保存'); };
  const { container } = render(<RulesPage repoId="repo-1" BodyEditor={FakeBodyEditor} />);
  const q = within(container);

  fireEvent.change(await q.findByLabelText('正文'), { target: { value: '# changed\n' } });
  fireEvent.click(q.getByRole('button', { name: '保存' }));

  const alert = await q.findByRole('alert');
  assert.match(alert.textContent ?? '', /已被外部修改/);
  assert.ok(within(alert).getByRole('button', { name: '重新加载' }));
});

test('存在未保存更改时切换规则会询问，取消后保持当前规则', async () => {
  const { render, within, fireEvent, waitFor } = await libs();
  const { RulesPage } = await pageModule();
  const { container } = render(<RulesPage repoId="repo-1" BodyEditor={FakeBodyEditor} />);
  const q = within(container);

  fireEvent.change(await q.findByLabelText('正文'), { target: { value: '# dirty\n' } });
  fireEvent.click(q.getByText('Vue 3 规范'));

  const dialog = await q.findByRole('dialog');
  assert.ok(within(dialog).getByRole('button', { name: '保存并继续' }));
  assert.ok(within(dialog).getByRole('button', { name: '放弃更改' }));
  fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));

  await waitFor(() => assert.strictEqual(q.queryByRole('dialog'), null));
  assert.strictEqual((q.getByLabelText('标题') as HTMLInputElement).value, '核心原则');
});

test('未保存更改选择放弃后切换目标规则', async () => {
  const { render, within, fireEvent, waitFor } = await libs();
  const { RulesPage } = await pageModule();
  const { container } = render(<RulesPage repoId="repo-1" BodyEditor={FakeBodyEditor} />);
  const q = within(container);

  fireEvent.change(await q.findByLabelText('正文'), { target: { value: '# dirty\n' } });
  fireEvent.click(q.getByText('Vue 3 规范'));
  const dialog = await q.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: '放弃更改' }));

  await waitFor(() => assert.strictEqual((q.getByLabelText('标题') as HTMLInputElement).value, 'Vue 3 规范'));
  assert.strictEqual((q.getByLabelText('正文') as HTMLTextAreaElement).value, '# Vue 3\n\n- 组合式 API\n');
});

test('未保存更改选择保存并继续后切换目标规则', async () => {
  const { render, within, fireEvent, waitFor } = await libs();
  const { RulesPage } = await pageModule();
  const { container } = render(<RulesPage repoId="repo-1" BodyEditor={FakeBodyEditor} />);
  const q = within(container);

  fireEvent.change(await q.findByLabelText('正文'), { target: { value: '# 保存后离开\n' } });
  fireEvent.click(q.getByText('Vue 3 规范'));
  const dialog = await q.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: '保存并继续' }));

  await waitFor(() => assert.strictEqual((q.getByLabelText('标题') as HTMLInputElement).value, 'Vue 3 规范'));
  assert.ok(calls.some((call) => call.channel === 'rules:save'));
});

test('正文含原始 HTML 时降级为源码编辑', async () => {
  const { render, within } = await libs();
  const { RulesPage } = await pageModule();
  docs['00-core'].body = '<div>raw</div>\n\n普通文本\n';
  const { container } = render(<RulesPage repoId="repo-1" BodyEditor={FakeBodyEditor} />);
  const q = within(container);

  const source = await q.findByLabelText('规则正文源码') as HTMLTextAreaElement;
  assert.match(source.value, /<div>raw<\/div>/);
  assert.strictEqual(q.queryByLabelText('正文'), null);
  assert.match(q.getByText(/包含编辑器不支持的语法/).textContent ?? '', /源码模式/);
});

test('hasUnsupportedMarkdown 忽略代码块中的 HTML', async () => {
  const { hasUnsupportedMarkdown } = await editorModule();
  assert.strictEqual(hasUnsupportedMarkdown('```html\n<div>x</div>\n```\n'), false);
  assert.strictEqual(hasUnsupportedMarkdown('- 普通列表\n'), false);
  assert.strictEqual(hasUnsupportedMarkdown('<details>raw</details>\n'), true);
});
