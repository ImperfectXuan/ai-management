// electron/src/core/mcp.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface McpServer {
  name: string;
  command?: string;
  url?: string;
  args?: string[];
  scope?: string[];
  [key: string]: unknown;
}

export type McpServersMap = Record<string, Omit<McpServer, 'name'>>;

async function readServers(aiwsDir: string): Promise<McpServersMap> {
  const file = path.join(aiwsDir, 'mcp', 'mcp.json');
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    return raw.servers ?? {};
  } catch {
    return {};
  }
}

async function writeServers(aiwsDir: string, servers: McpServersMap): Promise<void> {
  const file = path.join(aiwsDir, 'mcp', 'mcp.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ servers }, null, 2), 'utf8');
}

export async function listMcp(root: string): Promise<McpServer[]> {
  const servers = await readServers(path.join(root, '.ai-workspace'));
  return Object.entries(servers).map(([name, s]) => ({
    name,
    command: (s.command as string | undefined) ?? (s.url as string | undefined) ?? '',
    ...s,
  }));
}

export async function addMcp(root: string, name: string, command: string, args?: string[]): Promise<void> {
  const aiwsDir = path.join(root, '.ai-workspace');
  const servers = await readServers(aiwsDir);
  servers[name] = args?.length
    ? { command, args, scope: ['project'] }
    : { command, scope: ['project'] };
  await writeServers(aiwsDir, servers);
}

export async function removeMcp(root: string, name: string): Promise<void> {
  const aiwsDir = path.join(root, '.ai-workspace');
  const servers = await readServers(aiwsDir);
  delete servers[name];
  await writeServers(aiwsDir, servers);
}

export function mergeLocalMcp(base: McpServersMap, local: McpServersMap): McpServersMap {
  return { ...base, ...local };
}

export function getServersForScope(servers: McpServersMap, scope: string): McpServersMap {
  const out: McpServersMap = {};
  for (const [name, s] of Object.entries(servers)) {
    if (!s.scope || s.scope.includes(scope)) out[name] = s;
  }
  return out;
}
