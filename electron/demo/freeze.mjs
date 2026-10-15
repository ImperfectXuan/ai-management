import { cp, mkdir, mkdtemp, readdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { projectRoot } from './workspace.mjs';

const releaseDir = path.join(projectRoot, 'electron/release');
await mkdir(releaseDir, { recursive: true });
const base = await mkdtemp(path.join(releaseDir, 'demo-source-'));
const snapshot = path.join(base, 'source');
// 显式白名单：收集当前磁盘实现（含尚未跟踪的新模块），排除 vault、真实 MCP 与全局配置。
const includes = [
  '.ai-workspace/scripts', '.ai-workspace/adapters',
  'electron/src', 'electron/test', 'electron/demo', 'electron/build',
  'electron/package.json', 'electron/package-lock.json', 'electron/tsconfig.json', 'electron/electron-builder.yml',
  'electron/README.md', 'electron/ACCEPTANCE.zh-CN.md',
  'docs/guides/local-demo.zh-CN.md',
];
for (const relative of includes) {
  const destination = path.join(snapshot, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(path.join(projectRoot, relative), destination, { recursive: true });
}
const files = [];
async function inventory(dir) {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await inventory(file);
    else {
      const stat = await lstat(file);
      if (!stat.isFile()) throw new Error(`源码快照不接受软链接或特殊文件：${file}`);
      files.push({ path: path.relative(snapshot, file), mode: stat.mode & 0o777, sha256: createHash('sha256').update(await readFile(file)).digest('hex') });
    }
  }
}
await inventory(snapshot);
const sourceHash = createHash('sha256').update(JSON.stringify(files)).digest('hex');
const metadata = {
  createdAt: new Date().toISOString(),
  baselineCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim(),
  includesUncommittedChanges: true,
  node: process.version, platform: process.platform, arch: process.arch,
  sourceHash, files,
};
await writeFile(path.join(base, 'manifest.json'), JSON.stringify(metadata, null, 2) + '\n');
await writeFile(path.join(base, 'README.txt'), '本机演示源码快照（含当前未提交实现）。\n不包含 node_modules、真实密钥或已有用户配置。\n复现：cd source/electron && npm ci && npm run demo\n验证：npm run typecheck && npm test && npm run build\nNode.js 24；macOS arm64；需 git、jq。依赖安装需要网络，演示本身不需要。\n');
const archive = path.join(base, `aiws-demo-${sourceHash.slice(0, 12)}.tar.gz`);
execFileSync('tar', ['-czf', archive, '-C', base, 'source', 'manifest.json', 'README.txt']);
const archiveHash = createHash('sha256').update(await readFile(archive)).digest('hex');
await writeFile(`${archive}.sha256`, `${archiveHash}  ${path.basename(archive)}\n`);
console.log(`演示源码快照：${archive}\n内容指纹：${sourceHash}\n归档 SHA-256：${archiveHash}\n未执行 Git 提交；manifest 逐文件记录当前实现。`);
