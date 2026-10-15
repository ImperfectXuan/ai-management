import { spawn } from 'node:child_process';
import path from 'node:path';
import { prepareDemo, projectRoot } from './workspace.mjs';

const demo = await prepareDemo();
console.log(`独立演示环境：${demo.base}\n内容库：${demo.repo}\n应用项目：${demo.target}\n来源 A：${demo.sourceA}\n来源 B：${demo.sourceB}`);
const child = spawn(path.join(projectRoot, 'electron/node_modules/.bin/electron'), ['.', `--user-data-dir=${demo.profile}`], {
  cwd: path.join(projectRoot, 'electron'),
  // HOME 隔离，演示中即使选择全局链接也只影响临时目录。
  env: { ...process.env, HOME: demo.home },
  stdio: 'inherit',
});
child.on('error', (error) => { console.error('启动演示失败：', error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
