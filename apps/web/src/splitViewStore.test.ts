import { EnvironmentId, type ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_SPLIT_VIEW_LAYOUT,
  type SplitViewLayout,
  closeSplitViewPane,
  openAsideSplitViewPane,
  openSplitViewPane,
  reconcileSplitViewLayout,
  resizeSplitViewPanes,
} from "./splitViewStore";

const ref = (id: string): ScopedThreadRef => ({
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make(id),
});
const [a, b, c, d] = [ref("a"), ref("b"), ref("c"), ref("d")];
const ids = (layout: SplitViewLayout) => layout.panes.map((pane) => pane.thread.threadId);
const layoutOf = (panes: ScopedThreadRef[], focused: ScopedThreadRef): SplitViewLayout => ({
  panes: panes.map((thread) => ({ id: `pane-${thread.threadId}`, thread })),
  sizes: panes.map(() => 1 / panes.length),
  focusedId: `pane-${focused.threadId}`,
});
const asideOf = (layout: SplitViewLayout, aside: ScopedThreadRef, parent: ScopedThreadRef) =>
  openAsideSplitViewPane(layout, aside, parent);

describe("reconcileSplitViewLayout", () => {
  it("focuses the routed pane, or shows the route in the focused pane", () => {
    const split = layoutOf([a, b], a);
    expect(reconcileSplitViewLayout(split, b).focusedId).toBe("pane-b");
    const replaced = reconcileSplitViewLayout(split, c);
    expect(ids(replaced)).toEqual(["c", "b"]);
    // The pane keeps its id, so its chat stays mounted across the thread change.
    expect(replaced.panes[0]!.id).toBe("pane-a");
    expect(replaced.focusedId).toBe("pane-a");
    expect(reconcileSplitViewLayout(layoutOf([a], a), c).panes).toEqual([
      { id: "pane-a", thread: c },
    ]);
    // A lone chat gets a fixed id, so deriving it on every render never remounts the chat.
    const lone = reconcileSplitViewLayout(EMPTY_SPLIT_VIEW_LAYOUT, c);
    expect(ids(lone)).toEqual(["c"]);
    expect(reconcileSplitViewLayout(EMPTY_SPLIT_VIEW_LAYOUT, d).panes[0]!.id).toBe(
      lone.panes[0]!.id,
    );
  });
});

describe("side chat panes", () => {
  it("opens beside the thread's pane and never takes focus or the route", () => {
    const lone = asideOf(EMPTY_SPLIT_VIEW_LAYOUT, d, a);
    expect(ids(lone)).toEqual(["a", "d"]);
    expect(lone.sizes).toEqual([0.6, 0.4]);
    expect(lone.focusedId).toBe("primary");
    // Routing to the side chat itself does not focus it; the focused pane shows it instead.
    expect(reconcileSplitViewLayout(lone, a)).toBe(lone);
    const routedToAside = reconcileSplitViewLayout(lone, d);
    expect(routedToAside.focusedId).toBe("primary");
    expect(routedToAside.panes.filter((pane) => pane.asideOf)).toHaveLength(0);

    const split = asideOf(layoutOf([a, b], b), d, a);
    expect(ids(split)).toEqual(["a", "d", "b"]);
    expect(split.sizes).toEqual([0.3, 0.2, 0.5]);
    expect(split.focusedId).toBe("pane-b");
    // One side chat at a time: a new one takes over the pane.
    const replaced = asideOf(split, c, b);
    expect(ids(replaced)).toEqual(["a", "c", "b"]);
    expect(replaced.panes[1]!.id).toBe(split.panes[1]!.id);
    expect(replaced.panes[1]!.asideOf).toEqual(b);
  });

  it("goes with its thread when that pane closes or navigates away", () => {
    const split = asideOf(layoutOf([a, b], a), d, a);
    const navigated = reconcileSplitViewLayout(split, c);
    expect(ids(navigated)).toEqual(["c", "b"]);
    expect(navigated.sizes[0]).toBeCloseTo(0.5);
    expect(navigated.focusedId).toBe("pane-a");

    const closed = closeSplitViewPane(split, "pane-a");
    expect(ids(closed.layout)).toEqual(["b"]);
    expect(closed.focus).toEqual(b);

    // Closing the side chat itself leaves focus where it was.
    const dismissed = closeSplitViewPane(split, split.panes[1]!.id);
    expect(ids(dismissed.layout)).toEqual(["a", "b"]);
    expect(dismissed.focus).toBeNull();
    expect(dismissed.layout.sizes[0]).toBeCloseTo(0.5);
  });
});

describe("openSplitViewPane", () => {
  it("splits the target pane's width on the dropped side", () => {
    const opened = openSplitViewPane(layoutOf([a, b], a), c, 0, "after");
    expect(ids(opened)).toEqual(["a", "c", "b"]);
    expect(opened.sizes).toEqual([0.25, 0.25, 0.5]);
    expect(ids(openSplitViewPane(layoutOf([a], a), b, 0, "before"))).toEqual(["b", "a"]);
  });

  it("replaces the target pane when every pane is taken, and keeps a shown thread in place", () => {
    const full = layoutOf([a, b, c], a);
    const replaced = openSplitViewPane(full, d, 1, "after");
    expect(ids(replaced)).toEqual(["a", "d", "c"]);
    expect(replaced.panes[1]!.id).toBe("pane-b");
    expect(openSplitViewPane(full, c, 0, "before")).toBe(full);
  });
});

describe("closeSplitViewPane", () => {
  it("gives the width to a neighbour and moves focus off a closed focused pane", () => {
    const closed = closeSplitViewPane(layoutOf([a, b, c], b), "pane-b");
    expect(ids(closed.layout)).toEqual(["a", "c"]);
    expect(closed.layout.sizes).toEqual([2 / 3, 1 / 3]);
    expect(closed.layout.focusedId).toBe("pane-a");
    expect(closed.focus).toEqual(a);

    const first = closeSplitViewPane(layoutOf([a, b], b), "pane-a");
    expect(ids(first.layout)).toEqual(["b"]);
    expect(first.focus).toBeNull();
  });
});

describe("resizeSplitViewPanes", () => {
  it("moves one boundary and leaves the other panes alone", () => {
    const resized = resizeSplitViewPanes(layoutOf([a, b, c], a), 1, 0.25);
    expect(resized.sizes[0]).toBeCloseTo(1 / 3);
    expect(resized.sizes[1]).toBeCloseTo(1 / 6);
    expect(resized.sizes[2]).toBeCloseTo(1 / 2);
  });
});
