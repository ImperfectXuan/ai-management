export const SUPPORTED_TOOLS = ['codex', 'claude', 'cursor', 'trae'] as const;

export type SupportedTool = typeof SUPPORTED_TOOLS[number];

export type PerFileTool = 'cursor' | 'trae';

export const PER_FILE_TOOLS: readonly PerFileTool[] = ['cursor', 'trae'];
