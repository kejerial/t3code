import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { useMediaQuery } from "../hooks/useMediaQuery";
import { cn } from "../lib/utils";
import {
  PRIMARY_SPLIT_PANE_ID,
  SPLIT_VIEW_MAX_PANES,
  closeSplitViewPane,
  openSplitViewPane,
  reconcileSplitViewLayout,
  resizeSplitViewPanes,
  useSplitViewStore,
  type SplitViewLayout,
} from "../splitViewStore";
import { buildThreadRouteParams, type ThreadRouteTarget } from "../threadRoutes";
import { BackgroundThreadContext, SplitPaneContext } from "./chat/backgroundThread";
import { threadContextDropTargetProps, useThreadContextDrop } from "./chat/threadContextDrag";
import { ThreadRouteView } from "./ThreadRouteView";
import { SidebarInset } from "./ui/sidebar";

const PANE_MIN_WIDTH_PX = 320;
const KEYBOARD_RESIZE_STEP = 0.05;

interface ShownPane {
  readonly id: string;
  readonly target: ThreadRouteTarget;
}

function focusedPaneId(layout: SplitViewLayout): string {
  return layout.panes.some((pane) => pane.id === layout.focusedId)
    ? layout.focusedId!
    : (layout.panes[0]?.id ?? PRIMARY_SPLIT_PANE_ID);
}

/**
 * Up to three chats side by side. The routed thread is always the focused pane, so the URL and
 * sidebar highlight follow focus. Below `lg` only the focused pane shows and drops navigate.
 * `background` keeps the chats mounted, inert and in place under Settings or Usage.
 */
export function SplitChatView({
  target,
  background,
}: {
  target: ThreadRouteTarget;
  background: boolean;
}) {
  const navigate = useNavigate();
  const splitEnabled = useMediaQuery("lg");
  const stored = useSplitViewStore((state) => state.layout);
  const setLayout = useSplitViewStore((state) => state.setLayout);
  const layout =
    target.kind === "server" ? reconcileSplitViewLayout(stored, target.threadRef) : stored;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- persists the layout after a navigation from outside the split (sidebar, palette, links) moved the routed thread
  useEffect(() => {
    if (layout !== stored) setLayout(layout);
  }, [layout, setLayout, stored]);

  const focusedId = focusedPaneId(layout);
  const routeKey = target.kind === "server" ? scopedThreadKey(target.threadRef) : target.draftId;
  // Set while the user's own click or keystroke chose the focused pane, so its caret stays put.
  // Any later focus change (drop, close, sidebar, a thread change in the pane) moves the caret.
  const [userFocus, setUserFocus] = useState<{ paneId: string; routeKey: string } | null>(null);
  if (userFocus && (userFocus.paneId !== focusedId || userFocus.routeKey !== routeKey)) {
    setUserFocus(null);
  }
  const allPanes: ShownPane[] =
    layout.panes.length === 0
      ? [{ id: PRIMARY_SPLIT_PANE_ID, target }]
      : layout.panes.map((pane) => ({
          id: pane.id,
          target: pane.id === focusedId ? target : { kind: "server", threadRef: pane.thread },
        }));
  const panes = splitEnabled ? allPanes : allPanes.filter((pane) => pane.id === focusedId);
  const sizes = splitEnabled && layout.panes.length > 0 ? layout.sizes : panes.map(() => 1);

  const openThread = (thread: ScopedThreadRef) =>
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(thread) });
  const focusPane = (pane: ShownPane) => {
    if (pane.id === focusedId || pane.target.kind !== "server") return;
    setUserFocus({ paneId: pane.id, routeKey: scopedThreadKey(pane.target.threadRef) });
    // Focus first, so an action in the same click that navigates lands in this pane.
    setLayout({ ...layout, focusedId: pane.id });
    openThread(pane.target.threadRef);
  };
  const closePane = (id: string) => {
    const { layout: next, focus } = closeSplitViewPane(layout, id);
    setLayout(next);
    if (focus) openThread(focus);
  };
  const dropOnPane = (
    index: number,
    threads: ReadonlyArray<ScopedThreadRef>,
    side: "before" | "after",
  ) => {
    const thread = threads[0];
    if (!thread || background) return;
    if (splitEnabled) setLayout(openSplitViewPane(layout, thread, index, side));
    openThread(thread);
  };

  const paneElements = useRef(new Map<string, HTMLDivElement>());
  const startResize = (handleIndex: number, event: PointerEvent<HTMLDivElement>) => {
    const left = paneElements.current.get(panes[handleIndex]!.id);
    const right = paneElements.current.get(panes[handleIndex + 1]!.id);
    if (!left || !right) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const start = left.getBoundingClientRect().left;
    const width = right.getBoundingClientRect().right - start;
    const pair = (sizes[handleIndex] ?? 0) + (sizes[handleIndex + 1] ?? 0);
    const bound = Math.min(PANE_MIN_WIDTH_PX / width, 0.5);
    let share = (sizes[handleIndex] ?? 0) / pair;
    // Drags restyle the two panes directly, so the chats do not re-render on every move.
    const move = (moveEvent: globalThis.PointerEvent) => {
      share = Math.min(Math.max((moveEvent.clientX - start) / width, bound), 1 - bound);
      left.style.flexGrow = String(pair * share);
      right.style.flexGrow = String(pair * (1 - share));
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      setLayout(resizeSplitViewPanes(layout, handleIndex, share));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };
  const resizeByKey = (handleIndex: number, event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === "ArrowLeft"
        ? -KEYBOARD_RESIZE_STEP
        : event.key === "ArrowRight"
          ? KEYBOARD_RESIZE_STEP
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const pair = (sizes[handleIndex] ?? 0) + (sizes[handleIndex + 1] ?? 0);
    const share = (sizes[handleIndex] ?? 0) / pair + step;
    setLayout(resizeSplitViewPanes(layout, handleIndex, Math.min(Math.max(share, 0.2), 0.8)));
  };

  return (
    <SidebarInset
      className="h-svh min-h-0 flex-row overflow-hidden overscroll-y-none md:h-dvh"
      inert={background}
    >
      <div className="flex min-h-0 min-w-0 flex-1">
        {panes.map((pane, index) => {
          const focused = pane.id === focusedId;
          return [
            index > 0 ? (
              <div
                key={`handle:${pane.id}`}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize panes"
                aria-valuenow={Math.round(
                  ((sizes[index - 1] ?? 0) / ((sizes[index - 1] ?? 0) + (sizes[index] ?? 0))) * 100,
                )}
                tabIndex={0}
                className="relative z-10 w-px shrink-0 cursor-col-resize bg-border outline-none after:absolute after:inset-y-0 after:-inset-x-1.5 hover:bg-primary/50 focus-visible:bg-primary"
                onPointerDown={(event) => startResize(index - 1, event)}
                onKeyDown={(event) => resizeByKey(index - 1, event)}
              />
            ) : null,
            <SplitPane
              key={pane.id}
              pane={pane}
              size={sizes[index] ?? 1}
              count={panes.length}
              index={index}
              focused={focused}
              takeFocus={focused && userFocus?.paneId !== pane.id}
              background={background}
              full={layout.panes.length >= SPLIT_VIEW_MAX_PANES}
              splitEnabled={splitEnabled}
              register={(element) => {
                if (element) paneElements.current.set(pane.id, element);
                else paneElements.current.delete(pane.id);
              }}
              onFocus={() => focusPane(pane)}
              onClose={() => closePane(pane.id)}
              onDrop={(threads, side) => dropOnPane(index, threads, side)}
            />,
          ];
        })}
      </div>
    </SidebarInset>
  );
}

function SplitPane({
  pane,
  size,
  count,
  index,
  focused,
  takeFocus,
  background,
  full,
  splitEnabled,
  register,
  onFocus,
  onClose,
  onDrop,
}: {
  pane: ShownPane;
  size: number;
  count: number;
  index: number;
  focused: boolean;
  takeFocus: boolean;
  background: boolean;
  full: boolean;
  splitEnabled: boolean;
  register: (element: HTMLDivElement | null) => void;
  onFocus: () => void;
  onClose: () => void;
  onDrop: (threads: ReadonlyArray<ScopedThreadRef>, side: "before" | "after") => void;
}) {
  const dropRef = useRef<HTMLDivElement | null>(null);
  const targetKey =
    pane.target.kind === "server" ? scopedThreadKey(pane.target.threadRef) : pane.target.draftId;
  useThreadContextDrop(
    dropRef,
    pane.target.kind === "server" ? pane.target.threadRef.environmentId : null,
    targetKey,
    (threads, _isActive, side) => onDrop(threads, side),
  );
  return (
    <div
      ref={(element) => {
        dropRef.current = element;
        register(element);
      }}
      data-split-pane-focused={count > 1 && focused ? "true" : undefined}
      className="group/split-pane relative flex min-h-0 min-w-0 basis-0 flex-col"
      style={{ flexGrow: size }}
      // Only the user's own input moves focus here; a stray programmatic focus must not reroute.
      onPointerDownCapture={
        focused
          ? undefined
          : (event) => {
              // Closing a pane in the background leaves focus where it is.
              if (!(event.target as Element).closest("[data-split-pane-close]")) onFocus();
            }
      }
      onKeyDownCapture={focused ? undefined : onFocus}
      {...threadContextDropTargetProps()}
    >
      <BackgroundThreadContext value={background || !focused}>
        <SplitPaneContext
          value={{
            count,
            focused,
            first: index === 0,
            last: index === count - 1,
            takeFocus,
            onClose: count > 1 ? onClose : null,
          }}
        >
          <ThreadRouteView
            target={pane.target}
            routed={focused && !background}
            onMissing={focused ? noop : onClose}
          />
        </SplitPaneContext>
      </BackgroundThreadContext>
      {count > 1 ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 bg-primary/70 opacity-0 group-data-[split-pane-focused]/split-pane:opacity-100"
        />
      ) : null}
      {splitEnabled ? (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 z-30 hidden bg-primary/8 ring-2 ring-inset ring-primary/60",
            full
              ? "inset-x-0 group-data-[thread-context-over]/split-pane:block"
              : "w-1/2 group-data-[thread-context-over=after]/split-pane:right-0 group-data-[thread-context-over=after]/split-pane:block group-data-[thread-context-over=before]/split-pane:left-0 group-data-[thread-context-over=before]/split-pane:block",
          )}
        />
      ) : null}
    </div>
  );
}

const noop = () => {};
