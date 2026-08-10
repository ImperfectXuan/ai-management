// electron/src/core/config.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const SUPPORTED_TOOLS = ['codex', 'claude', 'cursor', 'trae'] as const;

export interface WorkspaceConfig {
  version: string;
  tools: string[];
  default_scope: string;
}

export async function loadConfig(aiwsDir: string): Promise<WorkspaceConfig> {
  const file = path.join(aiwsDir, 'config', 'workspace.json');
  try {
    const cfg = JSON.parse(await fs.readFile(file, 'utf8'));
    return {
      version: cfg.version ?? '1.0',
      tools: cfg.tools ?? [...SUPPORTED_TOOLS],
      default_scope: cfg.default_scope ?? 'project',
    };
  } catch {
    return { version: '1.0', tools: [...SUPPORTED_TOOLS], default_scope: 'project' };
  }
}

function home(): string {
  return process.env.HOME ?? '';
}

export function getToolMcpPath(root: string, tool: string, scope: 'global' | 'project'): string | null {
  if (scope === 'global') {
    switch (tool) {
      case 'claude': return path.join(home(), '.claude.json');
      case 'codex': return path.join(home(), '.codex', 'config.toml');
      case 'cursor': return path.join(home(), '.cursor', 'mcp.json');
      default: return null; // trae 无 global MCP
    }
  }
  switch (tool) {
    case 'claude': return path.join(root, '.mcp.json');
    case 'codex': return path.join(root, '.codex', 'config.toml');
    case 'cursor': return path.join(root, '.cursor', 'mcp.json');
    case 'trae': return path.join(root, '.trae', 'mcp.json');
    default: return null;
  }
}

export function getToolSkillsPath(root: string, tool: string, scope: 'global' | 'project'): string | null {
  if (scope === 'global') {
    switch (tool) {
      case 'codex':
      case 'claude': return path.join(home(), '.agents', 'skills');
      case 'cursor': return path.join(home(), '.cursor', 'skills');
      case 'trae': return path.join(home(), '.trae', 'skills');
      default: return null;
    }
  }
  switch (tool) {
    case 'codex':
    case 'claude': return path.join(root, '.agents', 'skills');
    case 'cursor': return path.join(root, '.cursor', 'skills');
    case 'trae': return path.join(root, '.trae', 'skills');
    default: return null;
  }
}
