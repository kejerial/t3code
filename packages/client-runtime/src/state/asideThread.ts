import type {
  OrchestrationV2Run,
  OrchestrationV2ThreadProjection,
  OrchestrationV2ThreadShell,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

/**
 * A side chat is a hidden fork of a thread (`kind: "aside"`), kept until a new one replaces it.
 * It forks from the newest completed run instead of `latest_stable`, which needs a checkpoint and
 * fails for non-git projects.
 */
export const ASIDE_THREAD_TITLE = "Side chat";
export const ASIDE_INTERACTION_MODE: ProviderInteractionMode = "plan";
export const ASIDE_RUNTIME_MODE: RuntimeMode = "approval-required";

export const isAsideThread = (thread: Pick<OrchestrationV2ThreadShell, "kind">): boolean =>
  thread.kind === "aside";

type SourceRun = Pick<OrchestrationV2Run, "id" | "status" | "requestedAt" | "completedAt">;

/** The newest completed run, or null when the thread has no settled response to fork from. */
export function selectAsideSourceRun<R extends SourceRun>(runs: ReadonlyArray<R>): R | null {
  let newest: R | null = null;
  let newestAt = Number.NEGATIVE_INFINITY;
  for (const run of runs) {
    if (run.status !== "completed") continue;
    const at = DateTime.toEpochMillis(run.completedAt ?? run.requestedAt);
    if (at >= newestAt) {
      newest = run;
      newestAt = at;
    }
  }
  return newest;
}

/** Live side chats forked from `parentThreadId`; a new one replaces these. */
export function findAsideThreads<
  T extends Pick<OrchestrationV2ThreadShell, "id" | "kind" | "forkedFrom" | "deletedAt">,
>(threads: ReadonlyArray<T>, parentThreadId: ThreadId): T[] {
  return threads.filter(
    (thread) =>
      isAsideThread(thread) &&
      thread.deletedAt === null &&
      thread.forkedFrom?.type === "run" &&
      thread.forkedFrom.threadId === parentThreadId,
  );
}

/** A side chat shows only its own exchange; the agent still holds the parent's context. */
export function asideOwnTurnItems<
  T extends {
    readonly visibility: OrchestrationV2ThreadProjection["visibleTurnItems"][number]["visibility"];
  },
>(rows: ReadonlyArray<T>): ReadonlyArray<T> {
  return rows.filter((row) => row.visibility === "local");
}
