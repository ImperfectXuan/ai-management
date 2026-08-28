// electron/src/core/skills.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadConfig, getToolSkillsPath } from './config';
import {
  type LinkState,
  classifyLinkState,
  prepareDirLinkTarget,
  createDirLink,
  removeDirLink,
  isManagedLinkTarget,
} from './links';

export type SkillLinkState = LinkState;

export interface Skill {
  name: string;
  description: string;
  // 每个工具的链接三态：managed（已链接）/ conflict（同名非管理目标）/ missing（未链接）
  linkStatus: Record<string, { global: SkillLinkState; project: SkillLinkState }>;
}

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true).catch(() => false);
}

function getTargetSkillNames(dirs: import('node:fs').Dirent[], skillName?: string): string[] {
  if (skillName) return [skillName];
  return dirs.filter((d) => d.isDirectory()).map((d) => d.name);
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
    const linkStatus: Record<string, { global: SkillLinkState; project: SkillLinkState }> = {};
    for (const tool of cfg.tools) {
      const g = getToolSkillsPath(root, tool, 'global');
      const p = getToolSkillsPath(root, tool, 'project');
      const sourceDir = path.join(skillsDir, d.name);
      linkStatus[tool] = {
        global: g ? await classifyLinkState(path.join(g, d.name), sourceDir) : 'missing',
        project: p ? await classifyLinkState(path.join(p, d.name), sourceDir) : 'missing',
      };
    }
    out.push({ name: d.name, description, linkStatus });
  }
  return out;
}

export async function linkSkills(root: string, scope: 'global' | 'project', tool?: string, skillName?: string): Promise<{ count: number }> {
  const aiwsDir = path.join(root, '.ai-workspace');
  const skillsDir = path.join(aiwsDir, 'skills');
  const cfg = await loadConfig(aiwsDir);
  const tools = tool ? [tool] : cfg.tools;
  const dirs = await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => [] as import('node:fs').Dirent[]);
  const targetSkillNames = getTargetSkillNames(dirs, skillName);
  let count = 0;
  for (const t of tools) {
    const base = getToolSkillsPath(root, t, scope);
    if (!base) continue;
    await fs.mkdir(base, { recursive: true });
    for (const name of targetSkillNames) {
      const source = path.join(skillsDir, name);
      if (!(await exists(path.join(source, 'SKILL.md')))) continue;
      const target = path.join(base, name);
      await prepareDirLinkTarget(source, target);
      await createDirLink(source, target);
      count++;
    }
  }
  return { count };
}

export async function unlinkSkills(root: string, scope: 'global' | 'project', tool?: string, skillName?: string): Promise<{ count: number }> {
  const aiwsDir = path.join(root, '.ai-workspace');
  const skillsDir = path.join(aiwsDir, 'skills');
  const cfg = await loadConfig(aiwsDir);
  const tools = tool ? [tool] : cfg.tools;
  const dirs = await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => [] as import('node:fs').Dirent[]);
  const skillNames = getTargetSkillNames(dirs, skillName);
  let count = 0;
  for (const t of tools) {
    const base = getToolSkillsPath(root, t, scope);
    if (!base) continue;
    for (const name of skillNames) {
      const source = path.join(skillsDir, name);
      const target = path.join(base, name);
      if ((await exists(target)) && (await isManagedLinkTarget(target, source))) {
        await removeDirLink(target);
        count++;
      }
    }
  }
  return { count };
}
