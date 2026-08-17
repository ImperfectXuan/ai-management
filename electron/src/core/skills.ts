// electron/src/core/skills.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadConfig, getToolSkillsPath } from './config';

export interface Skill {
  name: string;
  description: string;
  linkStatus: Record<string, { global: boolean; project: boolean }>;
}

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true).catch(() => false);
}

export async function listSkills(root: string): Promise<Skill[]> {
  const aiwsDir = path.join(root, '.ai-workspace');
  const skillsDir = path.join(aiwsDir, 'skills');
  const cfg = await loadConfig(aiwsDir);
  const dirs = await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => [] as import('node:fs').Dirent[]);
  const out: Skill[] = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const skillMd = path.join(skillsDir, d.name, 'SKILL.md');
    if (!(await exists(skillMd))) continue;
    const content = await fs.readFile(skillMd, 'utf8');
    const description = content.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? '';
    const linkStatus: Record<string, { global: boolean; project: boolean }> = {};
    for (const tool of cfg.tools) {
      const g = getToolSkillsPath(root, tool, 'global');
      const p = getToolSkillsPath(root, tool, 'project');
      linkStatus[tool] = {
        global: g ? await exists(path.join(g, d.name)) : false,
        project: p ? await exists(path.join(p, d.name)) : false,
      };
    }
    out.push({ name: d.name, description, linkStatus });
  }
  return out;
}

export async function linkSkills(root: string, scope: 'global' | 'project', tool?: string): Promise<{ count: number }> {
  const aiwsDir = path.join(root, '.ai-workspace');
  const skillsDir = path.join(aiwsDir, 'skills');
  const cfg = await loadConfig(aiwsDir);
  const tools = tool ? [tool] : cfg.tools;
  const dirs = await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => [] as import('node:fs').Dirent[]);
  let count = 0;
  for (const t of tools) {
    const base = getToolSkillsPath(root, t, scope);
    if (!base) continue;
    await fs.mkdir(base, { recursive: true });
    for (const d of dirs) {
      if (!d.isDirectory() || !(await exists(path.join(skillsDir, d.name, 'SKILL.md')))) continue;
      const target = path.join(base, d.name);
      await fs.rm(target, { recursive: true, force: true });
      await fs.symlink(path.join(skillsDir, d.name), target, 'dir');
      count++;
    }
  }
  return { count };
}

export async function unlinkSkills(root: string, scope: 'global' | 'project', tool?: string): Promise<{ count: number }> {
  const aiwsDir = path.join(root, '.ai-workspace');
  const skillsDir = path.join(aiwsDir, 'skills');
  const cfg = await loadConfig(aiwsDir);
  const tools = tool ? [tool] : cfg.tools;
  const dirs = await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => [] as import('node:fs').Dirent[]);
  const skillNames = dirs.filter((d) => d.isDirectory()).map((d) => d.name);
  let count = 0;
  for (const t of tools) {
    const base = getToolSkillsPath(root, t, scope);
    if (!base) continue;
    for (const name of skillNames) {
      const target = path.join(base, name);
      if (await exists(target)) {
        await fs.rm(target, { recursive: true, force: true });
        count++;
      }
    }
  }
  return { count };
}
