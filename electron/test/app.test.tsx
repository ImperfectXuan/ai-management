// electron/test/app.test.tsx
import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import React from 'react';
import { render, cleanup, within, fireEvent } from '@testing-library/react';

// 模块加载期建立 jsdom 全局（必须在 import App 之前，App.tsx 顶层 typeof document 守卫依赖它）
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
// Node >=21 的 globalThis.navigator 是只读 getter，直接赋值会抛 TypeError
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });

import { App } from '../src/renderer/App';

let handlers: Record<string, (p?: unknown) => unknown> = {};
let listeners: Array<[string, (d: unknown) => void]> = [];

beforeEach(() => {
  handlers = {
    'workspace:list': () => [],
    'library:get': () => ({path: '/library'}),
    'rules:list': () => [],
    'mcp:list': () => [],
    'skills:list': () => [],
  };
  listeners = [];
  (globalThis as any).window.api = {
    invoke: async (channel: string, payload?: unknown) => ({ ok: true, data: handlers[channel]?.(payload) ?? [] }),
    on: (channel: string, cb: (d: unknown) => void) => { listeners.push([channel, cb]); return () => {}; },
  };
  cleanup();
});

test('未选择内容库时显示内容库引导', async () => {
  handlers['library:get'] = () => null;
  const { container } = render(<App />);
  assert.ok(await within(container).findByRole('heading', { name: '统一内容库' }));
});

test('有仓库时渲染侧边栏与 tab', async () => {
  handlers['workspace:list'] = () => [{ id: '1', path: '/repo', name: 'repo', addedAt: 'x' }];
  const { container } = render(<App />);
  assert.ok(await within(container).findByRole('combobox', { name: '应用项目' }));
  assert.ok((await within(container).findAllByText('工作区概览')).length > 0);
  assert.ok((await within(container).findAllByText('差异对比')).length > 0);
});


test('仓库管理可以返回工作区，概览入口能打开收编', async () => {
  handlers['workspace:list'] = () => [{ id: '1', path: '/repo', name: 'repo', addedAt: 'x' }];
  handlers['intake:status'] = () => ({ apply_history: [] });
  const { container } = render(<App />);
  const q = within(container);
  await q.findByRole('button', { name: '收编已有配置 →' });
  fireEvent.click(q.getByRole('button', { name: '管理应用项目' }));
  await q.findByRole('heading', { name: '管理应用项目' });
  fireEvent.click(q.getByRole('button', { name: '← 返回工作区' }));
  fireEvent.click(await q.findByRole('button', { name: '收编已有配置 →' }));
  assert.ok(await q.findByRole('navigation', { name: '收编步骤' }));
});


test('已有项目也不会自动用作内容库', async () => {
  handlers['workspace:list'] = () => [{ id: '1', path: '/repo', name: 'repo', addedAt: 'x' }];
  handlers['library:get'] = () => null;
  const { container } = render(<App />);
  const q = within(container);

  await q.findByRole('heading', { name: '统一内容库' });

  assert.ok(q.getByRole('button', { name: '选择文件夹' }));
  assert.equal(q.queryByText('总库资产'), null);
});


test('无应用项目时仍能管理内容库，禁止同步', async () => {
  const { container } = render(<App />);
  const q = within(container);
  fireEvent.click(await q.findByRole('button', { name: '规则' }));

  assert.equal((await q.findByRole('button', { name: '同步 Cursor 规则' }) as HTMLButtonElement).disabled, true);
  fireEvent.click(q.getByRole('button', { name: '管理应用项目' }));
  assert.ok(await q.findByRole('heading', { name: '管理应用项目' }));
});


test('显式选择内容库后_无应用项目也能进入资产管理', async () => {
  handlers['library:get'] = () => null;
  handlers['directory:choose'] = () => '/chosen-library';
  handlers['library:select'] = (payload) => {
    assert.deepStrictEqual(payload, { path: '/chosen-library', initialize: true });
    return { path: '/chosen-library' };
  };
  const { container } = render(<App />);
  const q = within(container);
  fireEvent.click(await q.findByRole('button', { name: '选择文件夹' }));
  await q.findByDisplayValue('/chosen-library');
  fireEvent.click(q.getByRole('button', { name: '在此创建空内容库' }));

  assert.ok(await q.findByRole('heading', { name: '规则' }));
  assert.ok(q.getByText('/chosen-library'));
  assert.equal((q.getByRole('button', { name: '同步 Cursor 规则' }) as HTMLButtonElement).disabled, true);
});
