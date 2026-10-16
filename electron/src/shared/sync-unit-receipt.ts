// electron/src/shared/sync-unit-receipt.ts
// 功能 002：CLI 单元回执（schema v1）与 Desktop 侧严格校验（design §4）。
// 回执缺失、坏格式、身份不匹配或字段语义不符一律拒绝——调用方绝不能据此记成功。
import { ErrorCodes, WorkspaceError } from '../core/errors';
import { SyncModule, SyncScope, SyncTool } from './sync-status';

export interface SyncUnitReceipt {
  schemaVersion: 1;
  operationId: string;
  tool: SyncTool;
  module: SyncModule;
  scope: SyncScope;
  outcome: 'applied' | 'skipped' | 'failed';
  /** skipped/failed 必填；applied 不得携带。 */
  reasonCode?: string;
  /** 仅 applied 携带的 UTC ISO 8601 完成时间。 */
  completedAt?: string;
}

export interface ReceiptExpectation {
  operationId: string;
  tool: SyncTool;
  module: SyncModule;
  scope: SyncScope;
}

const UTC_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function reject(message: string): never {
  throw new WorkspaceError(ErrorCodes.SyncFailed, `同步回执无效：${message}`);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * 解析并严格校验单元回执：
 * - 身份（operationId/tool/module/scope）必须与本次请求完全一致；
 * - applied 必须带合法 UTC completedAt 且不得带 reasonCode；
 * - skipped/failed 必须带 reasonCode 且不得带 completedAt。
 */
export function parseSyncUnitReceipt(raw: string, expected: ReceiptExpectation): SyncUnitReceipt {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    reject('不是有效 JSON');
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) reject('不是对象');
  const receipt = doc as Record<string, unknown>;

  if (receipt.schemaVersion !== 1) reject(`不支持的 schemaVersion：${String(receipt.schemaVersion)}`);
  if (!isNonEmptyString(receipt.operationId)) reject('缺少 operationId');
  if (receipt.operationId !== expected.operationId) {
    reject(`operationId 不匹配（回执 ${receipt.operationId} ≠ 请求 ${expected.operationId}）`);
  }
  if (receipt.tool !== expected.tool) reject(`tool 不匹配：${String(receipt.tool)}`);
  if (receipt.module !== expected.module) reject(`module 不匹配：${String(receipt.module)}`);
  if (receipt.scope !== expected.scope) reject(`scope 不匹配：${String(receipt.scope)}`);

  const outcome = receipt.outcome;
  if (outcome !== 'applied' && outcome !== 'skipped' && outcome !== 'failed') {
    reject(`非法 outcome：${String(outcome)}`);
  }

  if (outcome === 'applied') {
    if (receipt.reasonCode !== undefined) reject('applied 不得携带 reasonCode');
    if (!isNonEmptyString(receipt.completedAt)) reject('applied 必须携带 completedAt');
    if (!UTC_ISO_PATTERN.test(receipt.completedAt) || !Number.isFinite(Date.parse(receipt.completedAt))) {
      reject(`completedAt 不是合法 UTC ISO 8601：${receipt.completedAt}`);
    }
  } else {
    if (receipt.completedAt !== undefined) reject(`${outcome} 不得携带 completedAt`);
    if (!isNonEmptyString(receipt.reasonCode)) reject(`${outcome} 必须携带 reasonCode`);
  }

  return {
    schemaVersion: 1,
    operationId: receipt.operationId,
    tool: receipt.tool as SyncTool,
    module: receipt.module as SyncModule,
    scope: receipt.scope as SyncScope,
    outcome,
    ...(receipt.reasonCode !== undefined ? { reasonCode: receipt.reasonCode as string } : {}),
    ...(receipt.completedAt !== undefined ? { completedAt: receipt.completedAt as string } : {}),
  };
}
