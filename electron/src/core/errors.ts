// electron/src/core/errors.ts
export const ErrorCodes = {
  WorkspaceNotFound: 'WorkspaceNotFound',
  NotAGitRepo: 'NotAGitRepo',
  AiwsNotInstalled: 'AiwsNotInstalled',
  GitNotInstalled: 'GitNotInstalled',
  UnsupportedTool: 'UnsupportedTool',
} as const;
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class WorkspaceError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'WorkspaceError';
    this.code = code;
    this.details = details;
  }
}
