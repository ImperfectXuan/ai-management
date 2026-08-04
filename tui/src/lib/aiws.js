const { spawn } = require('child_process');
const path = require('path');
const { execSync } = require('child_process');
const { parseResult } = require('./json');

function getRoot() {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  } catch {
    throw new Error('未在 git 仓库中运行（找不到 .ai-workspace）');
  }
}

const AIWS = path.join(getRoot(), '.ai-workspace', 'scripts', 'aiws');

function runAiws(args, { json = false } = {}) {
  const env = { ...process.env };
  if (json) env.AIWS_JSON = '1';
  return new Promise((resolve) => {
    const p = spawn(AIWS, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }));
  });
}

async function aiwsJson(args) {
  const res = await runAiws(args, { json: true });
  return { ...parseResult(res), code: res.code, stderr: res.stderr };
}

module.exports = { runAiws, aiwsJson, AIWS, getRoot };
