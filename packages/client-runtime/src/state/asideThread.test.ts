import { RunId, ThreadId, type OrchestrationV2Run } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { asideOwnTurnItems, findAsideThreads, selectAsideSourceRun } from "./asideThread.ts";
import { v2ThreadShell } from "./orchestrationV2TestFixtures.ts";

const at = (seconds: number) => DateTime.makeUnsafe(seconds * 1000);
const run = (
  id: string,
  status: OrchestrationV2Run["status"],
  requested: number,
  completed: number | null,
) => ({
  id: RunId.make(id),
  status,
  requestedAt: at(requested),
  completedAt: completed === null ? null : at(completed),
});

describe("selectAsideSourceRun", () => {
  it("picks the newest completed run and ignores later unsettled ones", () => {
    const runs = [
      run("old", "completed", 1, 2),
      run("newest", "completed", 3, 4),
      run("failed", "failed", 5, 6),
      run("running", "running", 7, null),
    ];
    expect(selectAsideSourceRun(runs)?.id).toBe("newest");
    expect(selectAsideSourceRun(runs.toReversed())?.id).toBe("newest");
  });

  it("returns null when no run completed", () => {
    expect(selectAsideSourceRun([])).toBeNull();
    expect(selectAsideSourceRun([run("running", "running", 1, null)])).toBeNull();
  });
});

describe("findAsideThreads", () => {
  it("lists live side chats forked from the parent only", () => {
    const parent = ThreadId.make("parent");
    const forkedFrom = { type: "run" as const, threadId: parent, runId: RunId.make("run") };
    const aside = {
      ...v2ThreadShell,
      id: ThreadId.make("aside"),
      kind: "aside" as const,
      forkedFrom,
    };
    const threads = [
      aside,
      { ...aside, id: ThreadId.make("deleted"), deletedAt: at(1) },
      {
        ...aside,
        id: ThreadId.make("other-parent"),
        forkedFrom: { ...forkedFrom, threadId: ThreadId.make("other") },
      },
      { ...v2ThreadShell, id: ThreadId.make("plain-fork"), forkedFrom },
    ];
    expect(findAsideThreads(threads, parent).map((thread) => thread.id)).toEqual(["aside"]);
  });
});

describe("asideOwnTurnItems", () => {
  it("keeps only the side chat's own rows, not the parent history or fork marker", () => {
    const rows = [
      { id: "parent-question", visibility: "inherited" as const },
      { id: "fork-marker", visibility: "synthetic" as const },
      { id: "side-question", visibility: "local" as const },
      { id: "side-answer", visibility: "local" as const },
    ];
    expect(asideOwnTurnItems(rows).map((row) => row.id)).toEqual(["side-question", "side-answer"]);
  });
});
