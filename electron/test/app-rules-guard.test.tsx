// electron/test/app-rules-guard.test.tsx
// App 级未保存保护：规则页存在未保存更改时，切换导航页签必须先处理。
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
type AppModule = typeof import('../src/renderer/App');
let tlCache: TL | null = null;
let appCache: AppModule | null = null;
async function libs(): Promise<TL> { if (!tlCache) tlCache = await import('@testing-library/react'); return tlCache; }
async function appModule(): Promise<AppModule> { if (!appCache) appCache = await import('../src/renderer/App'); return appCache; }

function FakeBodyEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <textarea aria-label="正文" value={value} onChange={(event) => onChange(event.target.value)} />;
}

const doc = {
  id: '00-core',
  domain: false,
  relativePath: 'rules/00-core.md',
  version: 'sha256:1',
  fields: { title: '核心原则', description: '', scope: 'all', globs: [], tools: [] },
  body: '# 核心原则\n',
};

let calls: Array<{ channel: string; payload: any }> = [];

beforeEach(async () => {
  const { cleanup } = await libs();
  cleanup();
  calls = [];
  (globalThis as any).window.api = {
    invoke: async (channel: string, payload?: any) => {
      calls.push({ channel, payload });
      const data: Record<string, unknown> = {
        'workspace:list': [{ id: '1', path: '/repo', name: 'repo', addedAt: 'x' }],
        'library:get': { path: '/library' },
        'rules:list': [{
          id: '00-core', title: '核心原则', scope: 'all', globs: '**/*',
          requiredByTool: { cursor: true, trae: false }, domain: false, tools: [],
        }],
        'rules:get': doc,
        'rules:save': { version: 'sha256:next' },
        'sync:status-get': { state: 'up-to-date', units: [], pendingCount: 0, applicableCount: 0, summaryText: '' },
        'intake:status': { apply_history: [] },
      };
      return { ok: true, data: data[channel] ?? [] };
    },
    on: () => () => {},
  };
});

async function openRulesAndEdit() {
  const { render, within, fireEvent, waitFor } = await libs();
  const { App } = await appModule();
  const { container } = render(<App BodyEditor={FakeBodyEditor} />);
  const q = within(container);
  fireEvent.click(await q.findByRole('button', { name: '规则' }));
  const body = await q.findByLabelText('正文');
  fireEvent.change(body, { target: { value: '# dirty\n' } });
  await waitFor(() => assert.strictEqual((q.getByLabelText('正文') as HTMLTextAreaElement).value, '# dirty\n'));
  return { q, fireEvent, waitFor };
}

test('App 导航：取消后停留在规则页', async () => {
  const { q, fireEvent, waitFor } = await openRulesAndEdit();

  fireEvent.click(q.getByRole('button', { name: '工作区概览' }));
  const dialog = await q.findByRole('dialog');
  fireEvent.click(withinDialog(dialog, '取消'));

  await waitFor(() => assert.strictEqual(q.queryByRole('dialog'), null));
  assert.ok(q.getByLabelText('正文'));
});

test('App 导航：放弃更改后切换页签', async () => {
  const { q, fireEvent, waitFor } = await openRulesAndEdit();

  fireEvent.click(q.getByRole('button', { name: '工作区概览' }));
  const dialog = await q.findByRole('dialog');
  fireEvent.click(withinDialog(dialog, '放弃更改'));

  await waitFor(() => assert.strictEqual(q.queryByLabelText('正文'), null));
  assert.strictEqual(calls.some((call) => call.channel === 'rules:save'), false);
});

test('App 导航：保存并继续后切换页签', async () => {
  const { act } = await libs();
  const { q, fireEvent, waitFor } = await openRulesAndEdit();

  fireEvent.click(q.getByRole('button', { name: '工作区概览' }));
  const dialog = await q.findByRole('dialog');
  await act(async () => { fireEvent.click(withinDialog(dialog, '保存并继续')); });

  await waitFor(() => assert.strictEqual(q.queryByLabelText('正文'), null));
  assert.ok(calls.some((call) => call.channel === 'rules:save'));
});

function withinDialog(dialog: HTMLElement, name: string): HTMLElement {
  const button = Array.from(dialog.querySelectorAll('button')).find((item) => item.textContent === name);
  assert.ok(button, `对话框缺少按钮 ${name}`);
  return button;
}
