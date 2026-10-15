// electron/src/core/diff.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { syncRun } from './sync';
import { WorkspaceError, ErrorCodes } from './errors';

export interface DiffHunk {
  removed: string[];
  added: string[];
}

export interface DiffResult {
  identical: boolean;
  hunks: DiffHunk[];
}

export function diffLines(a: string, b: string): DiffResult {
  const A = a.replace(/\n$/, '').split('\n');
  const B = b.replace(/\n$/, '').split('\n');
  const n = A.length;
  const m = B.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const hunks: DiffHunk[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { i++; j++; continue; }
    const h: DiffHunk = { removed: [], added: [] };
    // 按 LCS dp 表回溯：删除方向优先（dp[i+1][j] >= dp[i][j+1]），否则插入
    while (i < n || j < m) {
      if (i < n && j < m && A[i] === B[j]) break;
      if (i < n && (j >= m || dp[i + 1][j] >= dp[i][j + 1])) {
        h.removed.push(A[i++]);
      } else if (j < m) {
        h.added.push(B[j++]);
      } else {
        break;
      }
    }
    hunks.push(h);
  }
  return { identical: hunks.length === 0, hunks };
}

export async function compareRuleToGenerated(
  root: string,
  tool: 'cursor' | 'trae',
  ruleId: string
): Promise<{ source: string; generated: string; diff: DiffResult }> {
  if (!['cursor', 'trae'].includes(tool) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(ruleId)) {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, '差异对比需要有效的工具和规则 ID');
  }
  const ext = tool === 'cursor' ? '.mdc' : '.md';
  const generatedFile = path.join(root, tool === 'cursor' ? '.cursor' : '.trae', 'rules', `${ruleId}${ext}`);
  const sandbox = await fs.mkdtemp(path.join(tmpdir(), 'aiws-diff-'));
  try {
    // 用同一 CLI 在临时目录生成预期产物，避免把正常的 frontmatter 转换误报为漂移。
    for (const dir of ['scripts', 'rules', 'adapters', 'memory/context']) {
      const from = path.join(root, '.ai-workspace', dir);
      try {
        await fs.cp(from, path.join(sandbox, '.ai-workspace', dir), { recursive: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dir !== 'memory/context') throw error;
      }
    }
    for await (const _line of syncRun(sandbox, { tool, only: 'rules' })) { /* 只在临时目录生成 */ }
    const relative = path.relative(root, generatedFile);
    const source = await readGenerated(path.join(sandbox, relative));
    const generated = await readGenerated(generatedFile);
    return { source, generated, diff: diffLines(source, generated) };
  } finally {
    await fs.rm(sandbox, { recursive: true, force: true });
  }
}

async function readGenerated(file: string): Promise<string> {
  try { return await fs.readFile(file, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}
