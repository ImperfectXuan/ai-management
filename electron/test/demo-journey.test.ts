import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { prepareDemo } from '../demo/workspace.mjs';
import { intakeScan, intakeCompare, intakePlan, intakeApply, intakeRollback, intakeStatus } from '../src/core/intake-bridge';
import { syncRun } from '../src/core/sync';
import { runAiwsBridge, runAiwsJson } from '../src/core/vault-bridge';

async function treeDigest(root: string): Promise<string> {
  const hash = createHash('sha256');
  async function visit(dir: string): Promise<void> {
    for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(file);
      else { hash.update(path.relative(root, file)); hash.update(await fs.readFile(file)); }
    }
  }
  await visit(root);
  return hash.digest('hex');
}

// 两次完整旅程使用相互独立的全新总库，验证演示可以重置并重复执行。
for (const round of [1, 2]) {
  test(`demoJourney_round${round}_intakeSyncValidateRollbackPreservesSources`, async () => {
    const demo = await prepareDemo();
    const originalHome = process.env.HOME;
    process.env.HOME = demo.home;
    try {
      const before = await Promise.all([treeDigest(demo.sourceA), treeDigest(demo.sourceB)]);
      const scan = await intakeScan({ repoPath: demo.repo, sources: [
        { path: demo.sourceA, tool: 'cursor', scope: 'project' },
        { path: demo.sourceB, tool: 'trae', scope: 'project' },
      ] });
      const candidates = await intakeCompare(demo.repo, scan.batch_id);
      assert.ok(candidates.candidates.some((candidate) => candidate.occurrences.length > 1), '相同内容应归为同一候选');
      assert.ok(candidates.candidates.some((candidate) => candidate.labels.includes('conflict')), '存在需要显式审核的冲突');
      const plan = await intakePlan({ repoPath: demo.repo, batchId: scan.batch_id, decisions: candidates.candidates.map((candidate) => ({
        candidate_id: candidate.candidate_id,
        kind: candidate.labels.includes('conflict') || candidate.labels.includes('unparseable') ? 'ignore' : 'add',
      })) });
      assert.deepEqual(plan.unresolved, []);
      assert.ok(plan.actions.filter((action) => action.kind === 'add').every((action) => action.write_path?.startsWith('.ai-workspace/')), '新增动作在执行前必须展示实际路径');
      const applied = await intakeApply({ repoPath: demo.repo, planId: plan.plan_id });
      assert.equal(applied.status, 'ok');
      assert.equal((await intakeApply({ repoPath: demo.repo, planId: plan.plan_id })).status, 'already_applied');
      const logs: string[] = [];
      for await (const line of syncRun(demo.repo)) logs.push(line);
      assert.equal(logs.at(-1), '同步完成');
      for (const file of ['AGENTS.md', 'CLAUDE.md', '.cursor/rules/00-context.mdc', '.trae/rules/00-context.md']) {
        assert.match(await fs.readFile(path.join(demo.repo, file), 'utf8'), /独立总库/);
      }
      for (const prefix of ['.agents', '.cursor', '.trae']) {
        assert.match(await fs.readFile(path.join(demo.repo, prefix, 'skills/source-check/SKILL.md'), 'utf8'), /来源验证/);
      }
      assert.match(await fs.readFile(path.join(demo.repo, '.cursor/mcp.json'), 'utf8'), /demo-files/);
      assert.equal((await runAiwsBridge(demo.repo, ['validate'])).code, 0);
      const vault = await runAiwsJson(demo.repo, ['secrets', 'list', '--json']) as { vault_ready: boolean };
      assert.equal(vault.vault_ready, false);
      const history = await intakeStatus(demo.repo, {});
      assert.ok(history.apply_history.length > 0);
      const rolledBack = await intakeRollback(demo.repo, applied.apply_id);
      assert.equal(rolledBack.rollback?.status, 'rolled_back');
      await assert.rejects(fs.access(path.join(demo.repo, '.ai-workspace/skills/source-check')));
      assert.deepEqual(await Promise.all([treeDigest(demo.sourceA), treeDigest(demo.sourceB)]), before);
      assert.deepEqual(await fs.readdir(demo.home), [], '默认同步不写全局目录');
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      await fs.rm(demo.base, { recursive: true, force: true });
    }
  });
}
