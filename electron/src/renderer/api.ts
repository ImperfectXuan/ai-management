// electron/src/renderer/api.ts
import { IPC } from '../shared/ipc';

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  code?: string;
  message?: string;
}

declare global {
  interface Window {
    api: {
      invoke(channel: string, payload?: unknown): Promise<ApiResult<unknown>>;
      on(channel: string, callback: (data: unknown) => void): () => void;
    };
  }
}

export async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  const res = (await window.api.invoke(channel, payload)) as ApiResult<T>;
  if (!res.ok) {
    const err = new Error(res.message ?? '操作失败') as Error & { code?: string };
    err.code = res.code;
    throw err;
  }
  return res.data as T;
}

export function onProgress(channel: string, cb: (data: unknown) => void): () => void {
  return window.api.on(channel, cb);
}
