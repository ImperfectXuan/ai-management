// electron/src/main/intake-ipc.ts
// 收编 IPC 处理器注册。与 ipc.ts 分离是为了让 main 进程之外的测试能直接驱动这些处理器
// （ipc.ts 顶层有 app.getPath 副作用，import 即 crash）。
//
// 总库以路径标识：必须是已初始化的 AI Workspace；来源不做此要求，也不要求是 git 仓库。

import { WorkspaceError, ErrorCodes } from '../core/errors';
import { IPC } from '../shared/ipc';
import {
  assertIntakeRepo,
  intakeApply,
  intakeCompare,
  intakeListBatches,
  intakePlan,
  intakeReadBatch,
  intakeRollback,
  intakeScan,
  intakeStatus,
} from '../core/intake-bridge';
import {
  validateIntakeApplyArgs,
  validateIntakeBatchArgs,
  validateIntakePlanArgs,
  validateIntakeRepoArgs,
  validateIntakeRollbackArgs,
  validateIntakeScanArgs,
  validateIntakeStatusArgs,
} from './intake-args';

export interface IpcRegistrar {
  handle<TArgs, TResult>(channel: string, fn: (args: TArgs) => Promise<TResult>): void;
}

export type Broadcaster = (channel: string, payload: unknown) => void;

export function registerIntakeIpc(register: IpcRegistrar, broadcast: Broadcaster, selectedLibrary?: () => Promise<string>): void {
  const runs = new Map<string, AbortController>();

  function handle<TArgs, TResult>(channel: string, fn: (args: TArgs) => Promise<TResult>) {
    register.handle(channel, async (args: TArgs) => {
      if (selectedLibrary && validateIntakeRepoArgs(args, channel) !== await selectedLibrary()) {
        throw new WorkspaceError(ErrorCodes.InvalidArgument, '收编目标必须是当前统一内容库，请在“内容库存放位置”更换');
      }
      return fn(args);
    });
  }

  handle(IPC.IntakeListBatches, async (raw: unknown) => {
    const repoPath = validateIntakeRepoArgs(raw, 'IntakeListBatches');
    return intakeListBatches(repoPath);
  });

  handle(IPC.IntakeGetBatch, async (raw: unknown) => {
    const args = validateIntakeBatchArgs(raw, 'IntakeGetBatch');
    return intakeReadBatch(args.repoPath, args.batchId);
  });

  handle(IPC.IntakeScan, async (raw: unknown) => {
    const args = validateIntakeScanArgs(raw);
    await assertIntakeRepo(args.repoPath);
    const controller = new AbortController();
    runs.set(args.repoPath, controller);
    try {
      return await intakeScan({
        repoPath: args.repoPath,
        sources: args.sources,
        manualFiles: args.manualFiles,
        manualSkills: args.manualSkills,
        signal: controller.signal,
        onProgress: (ev) => broadcast(IPC.IntakeProgress, ev),
      });
    } finally {
      runs.delete(args.repoPath);
    }
  });

  handle(IPC.IntakeCompare, async (raw: unknown) => {
    const args = validateIntakeBatchArgs(raw, 'IntakeCompare');
    return intakeCompare(args.repoPath, args.batchId);
  });

  handle(IPC.IntakePlan, async (raw: unknown) => {
    return intakePlan(validateIntakePlanArgs(raw));
  });

  handle(IPC.IntakeApply, async (raw: unknown) => {
    const args = validateIntakeApplyArgs(raw);
    const controller = new AbortController();
    runs.set(args.repoPath, controller);
    try {
      return await intakeApply({
        repoPath: args.repoPath,
        planId: args.planId,
        resume: args.resume,
        signal: controller.signal,
        onProgress: (ev) => broadcast(IPC.IntakeProgress, ev),
      });
    } finally {
      runs.delete(args.repoPath);
    }
  });

  handle(IPC.IntakeRollback, async (raw: unknown) => {
    const args = validateIntakeRollbackArgs(raw);
    return intakeRollback(args.repoPath, args.applyId);
  });

  handle(IPC.IntakeStatus, async (raw: unknown) => {
    const args = validateIntakeStatusArgs(raw);
    return intakeStatus(args.repoPath, { planId: args.planId, batchId: args.batchId });
  });

  handle(IPC.IntakeCancel, async (raw: unknown) => {
    const repoPath = validateIntakeRepoArgs(raw, 'IntakeCancel');
    const controller = runs.get(repoPath);
    if (controller) controller.abort();
    return { cancelled: Boolean(controller) };
  });
}
