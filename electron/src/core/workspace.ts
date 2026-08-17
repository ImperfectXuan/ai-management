// electron/src/core/workspace.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceError, ErrorCodes } from './errors';
import { gitRoot, isGitInstalled } from './git';

export interface Repo {
  id: string;
  path: string;
  name: string;
  addedAt: string;
  lastSyncAt?: string;
}

interface ReposFile {
  repos: Repo[];
}

export class WorkspaceStore {
  constructor(private readonly file: string) {}

  async load(): Promise<Repo[]> {
    try {
      const raw: ReposFile = JSON.parse(await fs.readFile(this.file, 'utf8'));
      return Array.isArray(raw.repos) ? raw.repos : [];
    } catch {
      return [];
    }
  }

  private async save(repos: Repo[]): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify({ repos }, null, 2), 'utf8');
  }

  async add(dir: string): Promise<Repo> {
    if (!(await isGitInstalled())) {
      throw new WorkspaceError(ErrorCodes.GitNotInstalled, '未检测到 git，请安装 Command Line Tools');
    }
    const root = await gitRoot(dir);
    const repos = await this.load();
    const existing = repos.find((r) => r.path === root);
    if (existing) return existing;
    const repo: Repo = {
      id: randomUUID(),
      path: root,
      name: path.basename(root),
      addedAt: new Date().toISOString(),
    };
    repos.push(repo);
    await this.save(repos);
    return repo;
  }

  async remove(id: string): Promise<void> {
    const repos = await this.load();
    await this.save(repos.filter((r) => r.id !== id));
  }

  async get(id: string): Promise<Repo> {
    const repos = await this.load();
    const repo = repos.find((r) => r.id === id);
    if (!repo) throw new WorkspaceError(ErrorCodes.WorkspaceNotFound, '仓库不存在或已被移除');
    return repo;
  }

  async update(repo: Repo): Promise<void> {
    const repos = await this.load();
    const i = repos.findIndex((r) => r.id === repo.id);
    if (i < 0) throw new WorkspaceError(ErrorCodes.WorkspaceNotFound, '仓库不存在或已被移除');
    repos[i] = repo;
    await this.save(repos);
  }

  async assertAiwsInstalled(root: string): Promise<string> {
    const aiwsDir = path.join(root, '.ai-workspace');
    try {
      await fs.access(path.join(aiwsDir, 'scripts', 'aiws'));
      return aiwsDir;
    } catch {
      throw new WorkspaceError(ErrorCodes.AiwsNotInstalled, `'${root}' 未初始化 AI Workspace（缺 ${path.join(aiwsDir, 'scripts', 'aiws')}）`);
    }
  }
}
