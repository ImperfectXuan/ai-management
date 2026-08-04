const { test, before, after } = require('node:test');
const assert = require('node:assert');
const React = require('react');
const esbuild = require('esbuild');
const { render } = require('ink-testing-library');
const path = require('path');
const fs = require('fs');

let App;
let tmpFile;

before(() => {
  // 产物放 dist/（已 gitignore），保证 require('react')/ink 能从 tui/node_modules 解析
  tmpFile = path.join(__dirname, '..', 'dist', `screens-app-${process.pid}.cjs`);
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'src', 'app.jsx')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    jsx: 'transform',
    outfile: tmpFile,
    logLevel: 'silent',
  });
  ({ App } = require(tmpFile));
});

after(() => {
  if (tmpFile) { try { fs.unlinkSync(tmpFile); } catch { /* 忽略清理失败 */ } }
});

test('App 渲染六个 tab', () => {
  const { lastFrame } = render(React.createElement(App));
  const frame = lastFrame();
  assert.match(frame, /仪表盘/);
  assert.match(frame, /规则/);
  assert.match(frame, /MCP/);
  assert.match(frame, /技能/);
  assert.match(frame, /密钥/);
  assert.match(frame, /生效规则/);
});
