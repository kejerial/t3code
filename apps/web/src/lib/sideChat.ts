import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  ASIDE_INTERACTION_MODE,
  ASIDE_RUNTIME_MODE,
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
import { isAsidePane, openAsideSplitViewPane, useSplitViewStore } from "../splitViewStore";
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

const deleteThread = (thread: ScopedThreadRef) =>
  runAtomCommand(
    appAtomRegistry,
    threadEnvironment.delete,
    { environmentId: thread.environmentId, input: { threadId: thread.threadId } },
    { label: "close side chat" },
  );

/** Deletes the side chat; its pane closes once the thread is gone. */
export async function closeSideChat(thread: ScopedThreadRef): Promise<void> {
  failed(await deleteThread(thread), "Failed to close the side chat.");
}

function appendToDraft(thread: ScopedThreadRef, text: string) {
  const store = useComposerDraftStore.getState();
  const existing = store.getComposerDraft(thread)?.prompt.trimEnd() ?? "";
  store.setPrompt(thread, existing.length === 0 ? text : `${existing}\n${text}`);
}

/**
 * Opens a side chat beside `parent`. A question is sent as its first message; a draft is left in
 * its composer, and goes into the parent's side chat already on screen instead of a new one. The
 * parent's newest completed response is the fork point; a parent with none gets a notice.
 */
export async function openSideChat(
  parent: ScopedThreadRef,
  options: { readonly question?: string; readonly draft?: string } = {},
): Promise<boolean> {
  if (!readEnvironmentScope(parent.environmentId, AuthOrchestrationOperateScope)) {
    warn("This connection cannot open side chats.");
    return false;
  }
  const runs =
    appAtomRegistry.get(environmentThreadDetails.threadAtom(parent))?.projection.runs ?? [];
  const run = selectAsideSourceRun(runs);
  if (run === null) {
    warn(SIDE_CHAT_UNAVAILABLE_REASON);
    return false;
  }
  // One side chat pane at a time; one asked beside another thread goes before this one opens.
  // The command itself replaces an earlier side chat of the same parent.
  const shownAside = useSplitViewStore.getState().layout.panes.find(isAsidePane);
  const shownForParent =
    shownAside !== undefined && scopedThreadKey(shownAside.asideOf!) === scopedThreadKey(parent);
  if (shownForParent && options.draft !== undefined) {
    appendToDraft(shownAside.thread, options.draft);
    return true;
  }
  if (shownAside && !shownForParent) {
    await deleteThread(shownAside.thread);
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
  if (failed(opened, "Failed to open a side chat.")) return false;
  if (!(await waitForThreadShell(aside))) {
    warn("The side chat was created, but its thread data did not reach this client.");
    return false;
  }
  const { layout, setLayout } = useSplitViewStore.getState();
  if (options.draft !== undefined) appendToDraft(aside, options.draft);
  setLayout(openAsideSplitViewPane(layout, aside, parent));
  const question = options.question?.trim();
  if (!question) return true;
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
  return true;
}
