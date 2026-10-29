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
  /** Set on a side chat pane: the thread it was asked beside. It is never focused or routed. */
  readonly asideOf?: ScopedThreadRef;
}

export interface SplitViewLayout {
  readonly panes: readonly SplitViewPane[];
  readonly sizes: readonly number[];
  readonly focusedId: string | null;
}

export const EMPTY_SPLIT_VIEW_LAYOUT: SplitViewLayout = { panes: [], sizes: [], focusedId: null };

const newPane = (thread: ScopedThreadRef): SplitViewPane => ({ id: randomUUID(), thread });

export const isAsidePane = (pane: SplitViewPane) => pane.asideOf !== undefined;

const threadIndex = (layout: SplitViewLayout, thread: ScopedThreadRef) => {
  const key = scopedThreadKey(thread);
  return layout.panes.findIndex((pane) => scopedThreadKey(pane.thread) === key);
};

const withThread = (layout: SplitViewLayout, index: number, thread: ScopedThreadRef) =>
  layout.panes.map((pane, at) => (at === index ? { id: pane.id, thread } : pane));

/** Drops side chats whose thread left the split, with their widths going to the pane before. */
function withoutOrphanAsides(layout: SplitViewLayout): SplitViewLayout {
  const shown = new Set(
    layout.panes.filter((pane) => !isAsidePane(pane)).map((pane) => scopedThreadKey(pane.thread)),
  );
  const orphan = (pane: SplitViewPane) =>
    pane.asideOf !== undefined && !shown.has(scopedThreadKey(pane.asideOf));
  if (!layout.panes.some(orphan)) return layout;
  const sizes = [...layout.sizes];
  const panes: SplitViewPane[] = [];
  layout.panes.forEach((pane, index) => {
    if (!orphan(pane)) {
      panes.push(pane);
      return;
    }
    const neighbour = index > 0 ? index - 1 : index + 1;
    sizes[neighbour] = (sizes[neighbour] ?? 0) + (sizes[index] ?? 0);
  });
  return {
    panes,
    sizes: sizes.filter((_, index) => !orphan(layout.panes[index]!)),
    focusedId: layout.focusedId,
  };
}

/** The pane id a lone chat starts with, so deriving the layout in render never remounts it. */
export const PRIMARY_SPLIT_PANE_ID = "primary";

/**
 * The layout with the routed thread focused: its own pane, or the focused pane it replaces. A
 * side chat pane is never that pane, and one whose thread left the split goes with it.
 */
export function reconcileSplitViewLayout(
  layout: SplitViewLayout,
  route: ScopedThreadRef,
): SplitViewLayout {
  const shown = threadIndex(layout, route);
  if (shown !== -1 && !isAsidePane(layout.panes[shown]!)) {
    const id = layout.panes[shown]!.id;
    return layout.focusedId === id ? layout : { ...layout, focusedId: id };
  }
  const regular = layout.panes.filter((pane) => !isAsidePane(pane));
  if (regular.length === 0) {
    return {
      panes: [{ id: PRIMARY_SPLIT_PANE_ID, thread: route }],
      sizes: [1],
      focusedId: PRIMARY_SPLIT_PANE_ID,
    };
  }
  const focusedPane = regular.find((pane) => pane.id === layout.focusedId) ?? regular[0]!;
  const focused = layout.panes.indexOf(focusedPane);
  return withoutOrphanAsides({
    ...layout,
    panes: withThread(layout, focused, route),
    focusedId: focusedPane.id,
  });
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

/** The share of its thread's pane a new side chat takes. */
const ASIDE_PANE_SHARE = 0.4;

/**
 * Opens `aside` as the side chat of `parent`, right of the parent's pane. The split keeps one
 * side chat at a time: an existing one hands its pane over, so its chat stays mounted.
 */
export function openAsideSplitViewPane(
  layout: SplitViewLayout,
  aside: ScopedThreadRef,
  parent: ScopedThreadRef,
): SplitViewLayout {
  const current = layout.panes.findIndex(isAsidePane);
  if (current !== -1) {
    return {
      ...layout,
      panes: layout.panes.map((pane, index) =>
        index === current ? { id: pane.id, thread: aside, asideOf: parent } : pane,
      ),
    };
  }
  const pane = { ...newPane(aside), asideOf: parent };
  const target = threadIndex(layout, parent);
  if (target === -1) {
    return {
      panes: [{ id: PRIMARY_SPLIT_PANE_ID, thread: parent }, pane],
      sizes: [1 - ASIDE_PANE_SHARE, ASIDE_PANE_SHARE],
      focusedId: PRIMARY_SPLIT_PANE_ID,
    };
  }
  const parentSize = layout.sizes[target] ?? 1 / layout.panes.length;
  const sizes = layout.sizes.map((size, index) =>
    index === target ? parentSize * (1 - ASIDE_PANE_SHARE) : size,
  );
  return {
    ...layout,
    panes: [...layout.panes.slice(0, target + 1), pane, ...layout.panes.slice(target + 1)],
    sizes: [
      ...sizes.slice(0, target + 1),
      parentSize * ASIDE_PANE_SHARE,
      ...sizes.slice(target + 1),
    ],
  };
}

/**
 * Closes a pane; its width goes to a neighbour, and focus moves to the nearest pane that can
 * hold it if it was focused. Side chats of a closed pane close with it.
 */
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
  const focus =
    layout.focusedId === id
      ? (layout.panes
          .map((pane, index) => ({ pane, distance: Math.abs(index - closed) }))
          .filter(({ pane }) => pane.id !== id && !isAsidePane(pane))
          .toSorted((a, b) => a.distance - b.distance)[0]?.pane ?? null)
      : null;
  return {
    layout: withoutOrphanAsides({
      panes: layout.panes.filter((_, index) => index !== closed),
      sizes: sizes.filter((_, index) => index !== closed),
      focusedId: focus === null ? layout.focusedId : focus.id,
    }),
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

const isPane = Schema.is(
  Schema.Struct({
    id: Schema.String,
    thread: ScopedThreadRef,
    asideOf: Schema.optional(ScopedThreadRef),
  }),
);

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
