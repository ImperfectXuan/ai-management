import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ErrorCodes, WorkspaceError } from './errors';
import { SUPPORTED_TOOLS } from '../shared/tools';

export interface ContentLibrary {
  path: string;
}

/** 用户显式选择的统一内容库；与应用项目及其 Git 根目录无关。 */
export class ContentLibraryStore {
  constructor(private readonly file: string, private readonly runtimeScripts: string) {}

  async load(): Promise<ContentLibrary | null> {
    try {
      const library: ContentLibrary | null = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (!library || typeof library.path !== 'string' || !path.isAbsolute(library.path)) {
        throw new WorkspaceError(ErrorCodes.InvalidArgument, '内容库配置无效，请重新选择文件夹');
      }
      return library;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async get(): Promise<string> {
    const library = await this.load();
    if (!library) throw new WorkspaceError(ErrorCodes.AiwsNotInstalled, '请先选择统一内容库');
    await this.assertLibrary(library.path);
    return library.path;
  }

  /** 接入已有库或创建空库；只在初始化成功后持久化选择，不迁移已有资产。 */
  async select(directory: string, initialize = false): Promise<ContentLibrary> {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
      throw new WorkspaceError(ErrorCodes.InvalidArgument, '内容库需要已存在文件夹的绝对路径');
    }
    const root = await fs.realpath(directory);
    if (!(await fs.stat(root)).isDirectory()) {
      throw new WorkspaceError(ErrorCodes.InvalidArgument, '内容库路径必须是文件夹');
    }
    if (initialize) await this.initialize(root);
    await this.assertLibrary(root);
    const library = { path: root };
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(library, null, 2) + '\n', 'utf8');
    return library;
  }

  private async assertLibrary(root: string): Promise<void> {
    for (const relative of ['rules', 'skills', 'mcp', 'config', 'adapters', 'scripts']) {
      const directory = path.join(root, '.ai-workspace', relative);
      if (!(await fs.stat(directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      }))?.isDirectory()) {
        throw new WorkspaceError(ErrorCodes.AiwsNotInstalled, `内容库缺少 ${relative}/，请选择已有内容库或创建空内容库`);
      }
    }
    await fs.access(path.join(root, '.ai-workspace/config/workspace.json'));
  }

  private async initialize(root: string): Promise<void> {
    const aiws = path.join(root, '.ai-workspace');
    // mkdir 不使用 recursive：已有库必须显式接入，绝不覆盖它的规则、技能或凭据。
    await fs.access(path.join(this.runtimeScripts, 'aiws'));
    try { await fs.mkdir(aiws); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new WorkspaceError(ErrorCodes.InvalidArgument, '该文件夹已有 .ai-workspace，请选择“使用已有内容库”');
      }
      throw error;
    }
    try {
      for (const directory of ['rules/domains', 'skills', 'mcp', 'config', 'adapters', 'secrets', 'memory/context', 'memory/adr', 'memory/decisions']) {
        await fs.mkdir(path.join(aiws, directory), { recursive: true });
      }
      await fs.cp(this.runtimeScripts, path.join(aiws, 'scripts'), { recursive: true, force: false, errorOnExist: true });
      for (const tool of SUPPORTED_TOOLS) {
        const adapter = path.join(aiws, 'adapters', tool);
        await fs.mkdir(adapter);
        await fs.writeFile(path.join(adapter, 'mapping.yaml'), `tool: ${tool}\nrules:\n`);
      }
      await fs.writeFile(path.join(aiws, 'mcp/mcp.json'), '{"servers":{}}\n');
      await fs.writeFile(path.join(aiws, 'config/workspace.json'), JSON.stringify({
        version: '1.0', tools: SUPPORTED_TOOLS, default_scope: 'project', secrets: { enabled: false },
      }, null, 2) + '\n');
    } catch (error) {
      console.error('[content-library:initialize]', { root, error });
      throw new WorkspaceError(ErrorCodes.InvalidArgument, `内容库初始化失败：${root}；已创建文件保留，请检查目录权限与运行时资源`);
    }
  }
}
