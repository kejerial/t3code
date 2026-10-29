import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type UsageLimitSourceSnapshot,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { SidebarUsageLimits } from "./SidebarUsageLimits";

const state = vi.hoisted(() => ({ presentations: new Map() as Map<unknown, unknown> }));
vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  useAtomValue: () => state.presentations,
}));
vi.mock("../../state/presentation", () => ({
  environmentPresentations: { presentationsWithProvidersAtom: {} },
}));
vi.mock("../../hooks/useSettings", () => ({
  usePrimarySettings: (select: (settings: { timestampFormat: "locale" }) => unknown) =>
    select({ timestampFormat: "locale" }),
}));

vi.mock("../../hooks/useNowMinute", () => ({ useNowMinute: () => "2026-10-28T20:00" }));

const checkedAt = "2026-10-28T20:00:00.000Z";
const claude = ProviderDriverKind.make("claudeAgent");

const windows = (session: number, weekly: number) => [
  {
    id: "five_hour",
    kind: "session" as const,
    label: "5-hour",
    usedPercent: session,
    resetsAt: "2026-10-28T23:00:00.000Z",
  },
  {
    id: "seven_day",
    kind: "weekly" as const,
    label: "Weekly",
    usedPercent: weekly,
    resetsAt: "2026-10-30T20:30:00.000Z",
  },
];

const hub: UsageLimitSourceSnapshot = {
  id: "hub" as UsageLimitSourceSnapshot["id"],
  kind: "cliproxy",
  label: "Home hub",
  checkedAt,
  accounts: [
    {
      id: "a.json",
      driver: claude,
      email: "alpha@example.com",
      usageLimits: { checkedAt, windows: windows(12, 40) },
    },
    {
      id: "b.json",
      driver: claude,
      email: "beta@example.com",
      usageLimits: { checkedAt, windows: windows(95, 80) },
    },
    {
      id: "c.json",
      driver: ProviderDriverKind.make("codex"),
      email: "gone@example.com",
      usageLimits: { checkedAt, windows: [], unavailable: { reason: "probeFailed" } },
    },
  ],
};

// The same login as hub account "alpha", read directly by a Claude instance.
const directAlpha = {
  instanceId: ProviderInstanceId.make("claude"),
  driver: claude,
  enabled: true,
  installed: true,
  version: "2.1.312",
  status: "ready",
  auth: { status: "authenticated", email: "alpha@example.com" },
  checkedAt,
  models: [],
  slashCommands: [],
  skills: [],
  usageLimits: { checkedAt, windows: windows(12, 40) },
} as unknown as ServerProvider;

function setup(input: { providers?: ServerProvider[]; sources?: UsageLimitSourceSnapshot[] }) {
  state.presentations = new Map([
    [
      EnvironmentId.make("local"),
      {
        entry: { target: { label: "This Mac" } },
        serverConfig: { providers: input.providers ?? [], usageLimitSources: input.sources ?? [] },
      },
    ],
  ]);
}

const rows = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-testid="sidebar-usage-account"]')].map(
    (row) => row.textContent,
  );

describe("SidebarUsageLimits", () => {
  it("shows one row per account with 5-hour and weekly bars, deduping a direct login", async () => {
    localStorage.clear();
    setup({ providers: [directAlpha], sources: [hub] });
    await using screen = await render(<SidebarUsageLimits />);

    const accountRows = rows(screen.container);
    expect(accountRows).toHaveLength(2);
    expect(accountRows[0]).toContain("Claudealpha@example.com");
    expect(accountRows[0]).toContain("5-hour88%");
    expect(accountRows[0]).toContain("Weekly60%");
    expect(accountRows[1]).toContain("Claudebeta@example.com");
    expect(screen.container.textContent).not.toContain("gone");
    expect(
      screen.container.querySelector('[aria-label="Weekly: 60% left, resets in 2d 0h"]'),
    ).not.toBeNull();
  });

  it("collapses to one weekly bar per account and remembers it", async () => {
    localStorage.clear();
    setup({ sources: [hub] });
    await using screen = await render(<SidebarUsageLimits />);
    await act(() =>
      screen.container
        .querySelector<HTMLButtonElement>('[data-testid="sidebar-usage-toggle"]')
        ?.click(),
    );
    expect(rows(screen.container)).toEqual(["alpha60%", "beta20%"]);

    await using again = await render(<SidebarUsageLimits />);
    expect(
      again.container
        .querySelector('[data-testid="sidebar-usage-toggle"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("renders nothing when no account reports usage", async () => {
    setup({ sources: [{ ...hub, accounts: [hub.accounts[2]!] }] });
    await using screen = await render(<SidebarUsageLimits />);
    expect(screen.container.textContent).toBe("");
  });
});
