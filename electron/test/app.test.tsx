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

test('无仓库时渲染仓库管理页', async () => {
  const { container } = render(<App />);
  assert.ok(await within(container).findByRole('heading', { name: '管理仓库' }));
});

test('有仓库时渲染侧边栏与 tab', async () => {
  handlers['workspace:list'] = () => [{ id: '1', path: '/repo', name: 'repo', addedAt: 'x' }];
  const { container } = render(<App />);
  assert.ok(await within(container).findByRole('combobox', { name: '当前仓库' }));
  assert.ok((await within(container).findAllByText('工作区概览')).length > 0);
  assert.ok((await within(container).findAllByText('差异对比')).length > 0);
});


test('仓库管理可以返回工作区，概览入口能打开收编', async () => {
  handlers['workspace:list'] = () => [{ id: '1', path: '/repo', name: 'repo', addedAt: 'x' }];
  handlers['intake:status'] = () => ({ apply_history: [] });
  const { container } = render(<App />);
  const q = within(container);
  await q.findByRole('button', { name: '收编已有配置 →' });
  fireEvent.click(q.getByRole('button', { name: '管理仓库' }));
  await q.findByRole('heading', { name: '管理仓库' });
  fireEvent.click(q.getByRole('button', { name: '← 返回工作区' }));
  fireEvent.click(await q.findByRole('button', { name: '收编已有配置 →' }));
  assert.ok(await q.findByRole('navigation', { name: '收编步骤' }));
});
