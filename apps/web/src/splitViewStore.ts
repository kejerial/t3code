import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";
import { randomUUID } from "./lib/utils";

export const SPLIT_VIEW_MAX_PANES = 3;

/**
 * Threads shown side by side, left to right, with each pane's share of the width. A pane keeps its
 * id while its thread changes, so its ChatView stays mounted. The routed thread is always in the
 * focused pane; a navigation to a thread outside the split replaces that pane's thread.
 */
export interface SplitViewPane {
  readonly id: string;
  readonly thread: ScopedThreadRef;
}

export interface SplitViewLayout {
  readonly panes: readonly SplitViewPane[];
  readonly sizes: readonly number[];
  readonly focusedId: string | null;
}

export const EMPTY_SPLIT_VIEW_LAYOUT: SplitViewLayout = { panes: [], sizes: [], focusedId: null };

const newPane = (thread: ScopedThreadRef): SplitViewPane => ({ id: randomUUID(), thread });

const threadIndex = (layout: SplitViewLayout, thread: ScopedThreadRef) => {
  const key = scopedThreadKey(thread);
  return layout.panes.findIndex((pane) => scopedThreadKey(pane.thread) === key);
};

const withThread = (layout: SplitViewLayout, index: number, thread: ScopedThreadRef) =>
  layout.panes.map((pane, at) => (at === index ? { id: pane.id, thread } : pane));

/** The pane id a lone chat starts with, so deriving the layout in render never remounts it. */
export const PRIMARY_SPLIT_PANE_ID = "primary";

/** The layout with the routed thread focused: its own pane, or the focused pane it replaces. */
export function reconcileSplitViewLayout(
  layout: SplitViewLayout,
  route: ScopedThreadRef,
): SplitViewLayout {
  const shown = threadIndex(layout, route);
  if (shown !== -1) {
    const id = layout.panes[shown]!.id;
    return layout.focusedId === id ? layout : { ...layout, focusedId: id };
  }
  if (layout.panes.length === 0) {
    return {
      panes: [{ id: PRIMARY_SPLIT_PANE_ID, thread: route }],
      sizes: [1],
      focusedId: PRIMARY_SPLIT_PANE_ID,
    };
  }
  const focused = Math.max(
    layout.panes.findIndex((pane) => pane.id === layout.focusedId),
    0,
  );
  return {
    ...layout,
    panes: withThread(layout, focused, route),
    focusedId: layout.panes[focused]!.id,
  };
}

/**
 * Opens `thread` before or after the pane at `targetIndex`, splitting that pane's width. With
 * every pane taken it replaces the target pane's thread instead. A thread already shown stays
 * put; the caller navigates to it, which focuses its pane.
 */
export function openSplitViewPane(
  layout: SplitViewLayout,
  thread: ScopedThreadRef,
  targetIndex: number,
  side: "before" | "after",
): SplitViewLayout {
  if (threadIndex(layout, thread) !== -1) return layout;
  const target = Math.min(Math.max(targetIndex, 0), layout.panes.length - 1);
  if (target < 0) {
    const pane = newPane(thread);
    return { panes: [pane], sizes: [1], focusedId: pane.id };
  }
  if (layout.panes.length >= SPLIT_VIEW_MAX_PANES) {
    return { ...layout, panes: withThread(layout, target, thread) };
  }
  const at = side === "before" ? target : target + 1;
  const half = (layout.sizes[target] ?? 1 / layout.panes.length) / 2;
  const sizes = layout.sizes.map((size, index) => (index === target ? half : size));
  return {
    ...layout,
    panes: [...layout.panes.slice(0, at), newPane(thread), ...layout.panes.slice(at)],
    sizes: [...sizes.slice(0, at), half, ...sizes.slice(at)],
  };
}

/** Closes a pane; its width goes to a neighbour, and focus moves there if it was focused. */
export function closeSplitViewPane(
  layout: SplitViewLayout,
  id: string,
): { readonly layout: SplitViewLayout; readonly focus: ScopedThreadRef | null } {
  const closed = layout.panes.findIndex((pane) => pane.id === id);
  if (closed === -1 || layout.panes.length < 2) return { layout, focus: null };
  const neighbour = closed > 0 ? closed - 1 : 1;
  const sizes = layout.sizes.map((size, index) =>
    index === neighbour ? size + (layout.sizes[closed] ?? 0) : size,
  );
  const focus = layout.focusedId === id ? layout.panes[neighbour]! : null;
  return {
    layout: {
      panes: layout.panes.filter((_, index) => index !== closed),
      sizes: sizes.filter((_, index) => index !== closed),
      focusedId: focus === null ? layout.focusedId : focus.id,
    },
    focus: focus?.thread ?? null,
  };
}

/** Moves the boundary after pane `handleIndex` so that pane takes `leftShare` of the pair. */
export function resizeSplitViewPanes(
  layout: SplitViewLayout,
  handleIndex: number,
  leftShare: number,
): SplitViewLayout {
  const left = layout.sizes[handleIndex];
  const right = layout.sizes[handleIndex + 1];
  if (left === undefined || right === undefined || !Number.isFinite(leftShare)) return layout;
  const pair = left + right;
  const share = Math.min(Math.max(leftShare, 0), 1);
  return {
    ...layout,
    sizes: layout.sizes.map((size, index) =>
      index === handleIndex ? pair * share : index === handleIndex + 1 ? pair * (1 - share) : size,
    ),
  };
}

const isPane = Schema.is(Schema.Struct({ id: Schema.String, thread: ScopedThreadRef }));

function decodeLayout(value: unknown): SplitViewLayout {
  const layout = value as Partial<SplitViewLayout> | null;
  const panes = Array.isArray(layout?.panes) ? layout.panes.filter(isPane) : [];
  const sizes = Array.isArray(layout?.sizes) ? layout.sizes : [];
  const unique =
    new Set(panes.map((pane) => scopedThreadKey(pane.thread))).size === panes.length &&
    new Set(panes.map((pane) => pane.id)).size === panes.length;
  const sized =
    sizes.length === panes.length &&
    sizes.every((size) => typeof size === "number" && Number.isFinite(size) && size > 0);
  if (panes.length === 0 || panes.length > SPLIT_VIEW_MAX_PANES || !unique || !sized) {
    return EMPTY_SPLIT_VIEW_LAYOUT;
  }
  const total = sizes.reduce((sum, size) => sum + size, 0);
  return {
    panes,
    sizes: sizes.map((size) => size / total),
    focusedId: typeof layout?.focusedId === "string" ? layout.focusedId : null,
  };
}

interface SplitViewStoreState {
  readonly layout: SplitViewLayout;
  readonly setLayout: (layout: SplitViewLayout) => void;
}

export const useSplitViewStore = create<SplitViewStoreState>()(
  persist(
    (set) => ({
      layout: EMPTY_SPLIT_VIEW_LAYOUT,
      setLayout: (layout) => set((state) => (state.layout === layout ? state : { layout })),
    }),
    {
      name: "t3code:split-view:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      version: 1,
      partialize: ({ layout }) => ({ layout }),
      merge: (persisted, current) => ({
        ...current,
        layout: decodeLayout((persisted as { layout?: unknown } | null)?.layout),
      }),
    },
  ),
);
