import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  ASIDE_INTERACTION_MODE,
  ASIDE_RUNTIME_MODE,
  findAsideThreads,
  selectAsideSourceRun,
} from "@t3tools/client-runtime/state/threads";
import {
  AuthOrchestrationOperateScope,
  type OrchestrationV2Run,
  type ScopedThreadRef,
} from "@t3tools/contracts";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { useComposerDraftStore } from "~/composerDraftStore";
import { newMessageId, newThreadId } from "~/lib/utils";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { openAsideSplitViewPane, useSplitViewStore } from "../splitViewStore";
import { waitForThreadShell } from "../state/entities";
import { readEnvironmentScope } from "../state/session";
import { environmentThreadDetails, threadEnvironment } from "../state/threads";

export const SIDE_CHAT_UNAVAILABLE_REASON = "Side chat needs a completed response in this thread.";

type SourceRun = Pick<OrchestrationV2Run, "id" | "status" | "requestedAt" | "completedAt">;

/** Why the thread cannot host a side chat right now, or null when it can. */
export function sideChatUnavailableReason(runs: ReadonlyArray<SourceRun>): string | null {
  return selectAsideSourceRun(runs) === null ? SIDE_CHAT_UNAVAILABLE_REASON : null;
}

function warn(title: string, description?: string) {
  toastManager.add(
    stackedThreadToast({
      type: "warning",
      title,
      ...(description === undefined ? {} : { description }),
    }),
  );
}

function failed(result: AtomCommandResult<unknown, unknown>, fallback: string): boolean {
  if (result._tag !== "Failure") return false;
  if (!isAtomCommandInterrupted(result)) {
    const error = squashAtomCommandFailure(result);
    warn(fallback, error instanceof Error ? error.message : undefined);
  }
  return true;
}

function appendToDraft(thread: ScopedThreadRef, text: string) {
  const store = useComposerDraftStore.getState();
  const existing = store.getComposerDraft(thread)?.prompt.trimEnd() ?? "";
  store.setPrompt(thread, existing.length === 0 ? text : `${existing}\n${text}`);
}

async function sendQuestion(aside: ScopedThreadRef, question: string): Promise<void> {
  const sent = await runAtomCommand(
    appAtomRegistry,
    threadEnvironment.startTurn,
    {
      environmentId: aside.environmentId,
      input: {
        threadId: aside.threadId,
        message: { messageId: newMessageId(), role: "user", text: question, attachments: [] },
        runtimeMode: ASIDE_RUNTIME_MODE,
        interactionMode: ASIDE_INTERACTION_MODE,
      },
    },
    { label: "send side chat question" },
  );
  failed(sent, "The side chat opened, but the question was not sent.");
}

/** The side chat `parent` already has, which stays until a new one replaces it. */
function existingSideChat(parent: ScopedThreadRef): ScopedThreadRef | null {
  const threads = appAtomRegistry.get(
    threadEnvironment.snapshotAtom(parent.environmentId),
  )?.threads;
  const aside = findAsideThreads(threads ?? [], parent.threadId)[0];
  return aside ? scopeThreadRef(parent.environmentId, aside.id) : null;
}

async function forkSideChat(parent: ScopedThreadRef): Promise<ScopedThreadRef | null> {
  const runs =
    appAtomRegistry.get(environmentThreadDetails.threadAtom(parent))?.projection.runs ?? [];
  const run = selectAsideSourceRun(runs);
  if (run === null) {
    warn(SIDE_CHAT_UNAVAILABLE_REASON);
    return null;
  }
  const aside = scopeThreadRef(parent.environmentId, newThreadId());
  const opened = await runAtomCommand(
    appAtomRegistry,
    threadEnvironment.openAside,
    {
      environmentId: parent.environmentId,
      input: { sourceThreadId: parent.threadId, targetThreadId: aside.threadId, runId: run.id },
    },
    { label: "open side chat" },
  );
  if (failed(opened, "Failed to open a side chat.")) return null;
  if (!(await waitForThreadShell(aside))) {
    warn("The side chat was created, but its thread data did not reach this client.");
    return null;
  }
  return aside;
}

/**
 * Shows the side chat of `parent` beside it, reopening the one it has unless `fresh` asks for a
 * new fork from its newest completed response. A question is sent as a message; a draft is left
 * in its composer.
 */
export async function openSideChat(
  parent: ScopedThreadRef,
  options: { readonly question?: string; readonly draft?: string; readonly fresh?: boolean } = {},
): Promise<boolean> {
  if (!readEnvironmentScope(parent.environmentId, AuthOrchestrationOperateScope)) {
    warn("This connection cannot open side chats.");
    return false;
  }
  const aside = (options.fresh ? null : existingSideChat(parent)) ?? (await forkSideChat(parent));
  if (aside === null) return false;
  if (options.draft !== undefined) appendToDraft(aside, options.draft);
  const { layout, setLayout } = useSplitViewStore.getState();
  setLayout(openAsideSplitViewPane(layout, aside, parent));
  const question = options.question?.trim();
  if (question) await sendQuestion(aside, question);
  return true;
}
