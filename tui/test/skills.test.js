// tui/test/skills.test.js
// 技能屏集成测试：chdir 到沙盒 git 仓库并复制 aiws CLI，渲染真实 Skills 屏幕。
// 覆盖：列表渲染、详情页 scope 切换（B1）、单项链接落盘。
// 注意：全程只操作 project scope，不触碰宿主机全局目录；HOME 一并隔离。
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const React = require('react');
const esbuild = require('esbuild');
const { render } = require('ink-testing-library');
const fs = require('node:fs');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, lstatSync } = fs;
const { tmpdir } = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let tmpFile;
let tmpRoot;
let originalCwd;
let originalHome;

// 反复取最后一帧直到出现期望文本（CLI 子进程与 React 渲染都是异步的）
async function waitFor(lastFrame, pattern, tries = 50) {
  let frame = '';
  for (let i = 0; i < tries; i++) {
    frame = lastFrame() ?? '';
    if (pattern.test(frame)) return frame;
    await sleep(100);
  }
  return frame;
}

before(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'aiws-tui-skills-'));
  execSync('git init -q', { cwd: tmpRoot });
  const aiws = path.join(tmpRoot, '.ai-workspace');
  mkdirSync(path.join(aiws, 'skills', 'demo-a'), { recursive: true });
  mkdirSync(path.join(aiws, 'config'), { recursive: true });
  writeFileSync(
    path.join(aiws, 'skills', 'demo-a', 'SKILL.md'),
    '---\nname: demo-a\ndescription: 测试技能\n---\nbody\n'
  );
  writeFileSync(
    path.join(aiws, 'config', 'workspace.json'),
    JSON.stringify({ version: '1.0', tools: ['cursor'], default_scope: 'project', skills: { enabled: true } })
  );
  // chdir 后 getRoot() 解析到沙盒，需要那里也有一份 aiws CLI
  execSync(
    `cp -R "${path.join(__dirname, '..', '..', '.ai-workspace', 'scripts')}" "${path.join(aiws, 'scripts')}"`
  );

  tmpFile = path.join(__dirname, '..', 'dist', `skills-screen-${process.pid}.cjs`);
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'src', 'screens', 'skills.jsx')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    jsx: 'transform',
    outfile: tmpFile,
    logLevel: 'silent',
  });

  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  process.chdir(tmpRoot);
  process.env.HOME = tmpRoot;
});

after(() => {
  process.chdir(originalCwd);
  if (originalHome !== undefined) process.env.HOME = originalHome;
  if (tmpFile) { try { fs.unlinkSync(tmpFile); } catch { /* 忽略清理失败 */ } }
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

test('技能列表渲染技能名与描述', async () => {
  const { Skills } = require(tmpFile);
  const { lastFrame, unmount } = render(React.createElement(Skills));
  try {
    const frame = await waitFor(lastFrame, /demo-a/);
    assert.match(frame, /demo-a/);
    assert.match(frame, /测试技能/);
  } finally {
    unmount();
  }
});

test('详情页 s 切换 scope 后 l 单项链接到 project', async () => {
  const { Skills } = require(tmpFile);
  const { lastFrame, stdin, unmount } = render(React.createElement(Skills));
  try {
    await waitFor(lastFrame, /demo-a/);
    stdin.write('\r');
    await waitFor(lastFrame, /当前操作范围（scope）：global/);

    stdin.write('s');
    const frame = await waitFor(lastFrame, /当前操作范围（scope）：project/);
    assert.match(frame, /当前操作范围（scope）：project/);

    stdin.write('l');
    const target = path.join(tmpRoot, '.cursor', 'skills', 'demo-a');
    for (let i = 0; i < 50 && !fs.existsSync(target); i++) await sleep(100);
    assert.ok(lstatSync(target).isSymbolicLink(), 'l 应在 project scope 落盘 symlink');
  } finally {
    unmount();
  }
});
