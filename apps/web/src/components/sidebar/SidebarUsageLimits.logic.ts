import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import { type LimitAccount, remainingPercent } from "@t3tools/shared/usageLimits";

import { PROVIDER_PRESENTATION } from "../usage/usageProviders";

export type SidebarUsageTone = "normal" | "warning" | "critical";

export interface SidebarUsageAccount {
  readonly key: string;
  readonly driver: LimitAccount["driver"];
  /** Provider name for the expanded header, e.g. "Claude". */
  readonly provider: string;
  /** Account email, or the instance name when the provider reports none. */
  readonly identity: string;
  /** Short name for a collapsed row: the email's local part. */
  readonly label: string;
  /** Short windows first: the 5-hour session, then weekly, then anything longer. */
  readonly windows: readonly ServerProviderUsageWindow[];
  /** The one bar a collapsed section shows: weekly when reported. */
  readonly primary: ServerProviderUsageWindow;
}

const PROVIDER_NAMES: Record<string, string> = { claudeAgent: "Claude", codex: "Codex" };

function providerName(driver: LimitAccount["driver"]): string {
  return (
    PROVIDER_NAMES[driver] ??
    Object.values(PROVIDER_PRESENTATION).find((entry) => entry.driverKind === driver)?.label ??
    String(driver)
  );
}

const WINDOW_ORDER: Record<string, number> = { session: 0, weekly: 1, monthly: 2 };

export function usageTone(window: ServerProviderUsageWindow): SidebarUsageTone {
  const left = remainingPercent(window);
  if (left <= 10) return "critical";
  if (left <= 25) return "warning";
  return "normal";
}

/** Accounts with at least one bar, named by provider and email. */
export function sidebarUsageAccounts(
  accounts: readonly LimitAccount[],
): readonly SidebarUsageAccount[] {
  return accounts
    .flatMap((account): SidebarUsageAccount[] => {
      // Model-scoped limits ("Weekly · Fable") repeat the account's weekly bar; keep the main ones.
      const windows = account.limits.windows
        .filter((window) => !window.label.includes(" · "))
        .toSorted(
          (left, right) => (WINDOW_ORDER[left.kind] ?? 3) - (WINDOW_ORDER[right.kind] ?? 3),
        );
      const primary = windows.find((window) => window.kind === "weekly") ?? windows[0];
      if (!primary) return [];
      const email = account.email?.trim();
      const identity = email || account.displayName || "Account";
      return [
        {
          key: account.key,
          driver: account.driver,
          provider: providerName(account.driver),
          identity,
          label: email?.split("@")[0] || identity,
          windows,
          primary,
        },
      ];
    })
    .toSorted(
      (left, right) =>
        String(left.driver).localeCompare(String(right.driver)) ||
        left.label.localeCompare(right.label),
    );
}
