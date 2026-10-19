import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
type TestingLibrary = typeof import('@testing-library/react');
let library: TestingLibrary;
let pages: { RulesPage: typeof import('../src/renderer/pages/rules').RulesPage; SecretsPage: typeof import('../src/renderer/pages/secrets').SecretsPage; DashboardPage: typeof import('../src/renderer/pages/dashboard').DashboardPage };

async function load() {
  library ??= await import('@testing-library/react');
  pages ??= { ...(await import('../src/renderer/pages/rules')), ...(await import('../src/renderer/pages/secrets')), ...(await import('../src/renderer/pages/dashboard')) };
  return { ...library, ...pages };
}

function FakeEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <textarea aria-label="正文" value={value} onChange={(event) => onChange(event.target.value)} />;
}

let calls: Array<{ channel: string; payload: unknown }>;
let failChannel: string;
beforeEach(() => {
  calls = []; failChannel = '';
  window.api = {
    invoke: async (channel: string, payload?: unknown) => {
      calls.push({ channel, payload });
      if (channel === failChannel) return { ok: false, message: '模拟 CLI 执行失败' };
      if (channel === 'rules:list') return { ok: true, data: [{ id: 'demo', title: 'Demo', scope: 'all', globs: '**/*', domain: false, requiredByTool: { cursor: false, trae: false }, tools: [] }] };
      if (channel === 'rules:get') return {
        ok: true,
        data: {
          id: 'demo', domain: false, relativePath: 'rules/demo.md', version: 'sha256:demo',
          fields: { title: 'Demo', description: '', scope: 'all', globs: [], tools: [] },
          body: '# Demo\n',
        },
      };
      if (channel === 'rules:save') return { ok: true, data: { version: 'sha256:next' } };
      if (channel === 'secrets:list') return { ok: true, data: { secrets: [], vault_ready: false } };
      if (channel === 'secrets:audit') return { ok: true, data: { tools: [] } };
      return { ok: true, data: [] };
    },
    on: () => () => {},
  };
});
afterEach(() => library?.cleanup());

test('rulesPage_toggleAndReload_keepsSyncButtonEnabledAndSyncsOnlyRules', async () => {
  const { render, within, fireEvent, waitFor, RulesPage } = await load();
  const { container } = render(<RulesPage repoId="demo" BodyEditor={FakeEditor} />);
  const q = within(container);
  fireEvent.click(await q.findByRole('checkbox', { name: '常驻加载 demo' }));

  await waitFor(() => assert.equal((q.getByText('同步 Cursor 规则') as HTMLButtonElement).disabled, false));
  fireEvent.click(q.getByText('同步 Cursor 规则'));

  await q.findByText('已同步 Cursor 规则');
  assert.deepEqual(calls.find((call) => call.channel === 'sync:run')?.payload, { repoId: 'demo', tool: 'cursor', only: 'rules' });
});

test('secretsPage_cliFailure_showsErrorInsteadOfUninitializedVault', async () => {
  failChannel = 'secrets:list';
  const { render, within, SecretsPage } = await load();
  const { container } = render(<SecretsPage repoId="demo" />);
  const q = within(container);

  assert.match((await q.findByRole('alert')).textContent ?? '', /模拟 CLI 执行失败/);
  assert.equal(q.queryByText(/vault 未初始化/), null);
});

test('dashboard_syncFailure_showsFailureAndAllowsRetry', async () => {
  failChannel = 'sync:run';
  const { render, within, fireEvent, DashboardPage } = await load();
  const { container } = render(<DashboardPage repoId="demo" />);
  const q = within(container);
  await library.waitFor(() => assert.equal((q.getByRole('button', { name: '同步到四个工具' }) as HTMLButtonElement).disabled, false));
  fireEvent.click(q.getByRole('button', { name: '同步到四个工具' }));

  await q.findByText('模拟 CLI 执行失败');
  assert.equal((q.getByRole('button', { name: '同步到四个工具' }) as HTMLButtonElement).disabled, false);
});


test('dashboard_readFailure_doesNotPresentZeroCountsAsLoadedAssets', async () => {
  failChannel = 'rules:list';
  const { render, within, DashboardPage } = await load();
  const { container } = render(<DashboardPage repoId="demo" />);
  const q = within(container);

  assert.match((await q.findByRole('alert')).textContent ?? '', /读取资产失败/);
  assert.equal((q.getByRole('button', { name: '同步到四个工具' }) as HTMLButtonElement).disabled, true);
  assert.equal(q.queryByText('0 项'), null);
});
