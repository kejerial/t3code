import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import { type LimitAccount, remainingPercent } from "@t3tools/shared/usageLimits";

export type SidebarUsageTone = "normal" | "warning" | "critical";

export interface SidebarUsageAccount {
  readonly key: string;
  readonly driver: LimitAccount["driver"];
  readonly label: string;
  readonly title: string;
  readonly plan: string | undefined;
  /** Short windows first: the 5-hour session, then weekly, then anything longer. */
  readonly windows: readonly ServerProviderUsageWindow[];
  /** The one bar a collapsed section shows: weekly when reported. */
  readonly primary: ServerProviderUsageWindow;
}

const WINDOW_ORDER: Record<string, number> = { session: 0, weekly: 1, monthly: 2 };

export function usageTone(window: ServerProviderUsageWindow): SidebarUsageTone {
  const left = remainingPercent(window);
  if (left <= 10) return "critical";
  if (left <= 25) return "warning";
  return "normal";
}

/** Accounts with at least one bar, labelled by the email's local part so rows stay short. */
export function sidebarUsageAccounts(
  accounts: readonly LimitAccount[],
): readonly SidebarUsageAccount[] {
  return accounts
    .flatMap((account): SidebarUsageAccount[] => {
      const windows = account.limits.windows.toSorted(
        (left, right) => (WINDOW_ORDER[left.kind] ?? 3) - (WINDOW_ORDER[right.kind] ?? 3),
      );
      const primary = windows.find((window) => window.kind === "weekly") ?? windows[0];
      if (!primary) return [];
      const email = account.email?.trim();
      const label = account.displayName ?? email?.split("@")[0] ?? "Account";
      return [
        {
          key: account.key,
          driver: account.driver,
          label,
          title: email ?? label,
          plan: account.plan,
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
