// electron/src/core/diff.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';

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
  const aiwsDir = path.join(root, '.ai-workspace');
  const domain = await fs.access(path.join(aiwsDir, 'rules', 'domains', `${ruleId}.md`))
    .then(() => true)
    .catch(() => false);
  const sourceFile = path.join(aiwsDir, 'rules', domain ? 'domains' : '', `${ruleId}.md`);
  const ext = tool === 'cursor' ? '.mdc' : '.md';
  const generatedFile = path.join(root, tool === 'cursor' ? '.cursor' : '.trae', 'rules', `${ruleId}${ext}`);
  const source = await fs.readFile(sourceFile, 'utf8');
  const generated = await fs.readFile(generatedFile, 'utf8').catch(() => '');
  return { source, generated, diff: diffLines(source, generated) };
}
