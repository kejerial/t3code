import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import {
  type LimitAccount,
  type LimitPresentations,
  collectLimitAccounts,
  hubAccountLabel,
  isMainUsageWindow,
  limitsNotice,
  poolHubAccounts,
  pooledInstanceName,
  remainingPercent,
} from "@t3tools/shared/usageLimits";

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

function sortWindows(windows: readonly ServerProviderUsageWindow[]) {
  return windows.toSorted(
    (left, right) => (WINDOW_ORDER[left.kind] ?? 3) - (WINDOW_ORDER[right.kind] ?? 3),
  );
}

function primaryWindow(windows: readonly ServerProviderUsageWindow[]) {
  return windows.find((window) => window.kind === "weekly") ?? windows[0];
}

export function usageTone(window: ServerProviderUsageWindow): SidebarUsageTone {
  const left = remainingPercent(window);
  if (left <= 10) return "critical";
  if (left <= 25) return "warning";
  return "normal";
}

/** Accounts with at least one bar, named by provider and email. */
function sidebarUsageAccounts(accounts: readonly LimitAccount[]): readonly SidebarUsageAccount[] {
  return accounts
    .flatMap((account): SidebarUsageAccount[] => {
      // Model-scoped limits ("Weekly · Fable") repeat the account's weekly bar; keep the main ones.
      const windows = sortWindows(account.limits.windows.filter(isMainUsageWindow));
      const primary = primaryWindow(windows);
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

export interface SidebarUsagePoolMember {
  readonly key: string;
  /** Email, or the hub's account file name. */
  readonly identity: string;
  readonly label: string;
  /** Weekly when reported; null when the hub could not read this account. */
  readonly window: ServerProviderUsageWindow | null;
}

export interface SidebarUsagePool {
  readonly key: string;
  readonly driver: LimitAccount["driver"];
  /** "Claude · hub", or the routed instance's own name. */
  readonly name: string;
  readonly sourceLabel: string;
  readonly readableCount: number;
  readonly windows: readonly ServerProviderUsageWindow[];
  readonly primary: ServerProviderUsageWindow;
  readonly members: readonly SidebarUsagePoolMember[];
}

const emailKey = (driver: LimitAccount["driver"], email: string | undefined) =>
  email?.trim() ? `${driver}:${email.trim().toLowerCase()}` : null;

/** A pooled entry per hub-routed instance; its accounts leave the per-account list. */
export function sidebarUsage(
  presentations: LimitPresentations,
  now: number,
): {
  readonly pools: readonly SidebarUsagePool[];
  readonly accounts: readonly SidebarUsageAccount[];
} {
  const pools: SidebarUsagePool[] = [];
  const pooledKeys = new Set<string>();
  const labelEnvironment = presentations.size > 1;
  for (const [environmentId, presentation] of presentations) {
    const providers = (presentation.serverConfig?.providers ?? []).filter(
      (provider) => provider.enabled,
    );
    for (const source of presentation.serverConfig?.usageLimitSources ?? []) {
      const routed = providers.filter((provider) =>
        source.pooledInstanceIds?.includes(provider.instanceId),
      );
      const seenDrivers = new Set<string>();
      for (const provider of routed) {
        if (seenDrivers.has(provider.driver)) continue;
        seenDrivers.add(provider.driver);
        const pool = poolHubAccounts(source.accounts, provider.driver, now);
        const windows = sortWindows(pool.windows);
        const primary = primaryWindow(windows);
        if (!primary) continue;
        for (const account of pool.members) {
          pooledKeys.add(`${source.id}:${account.id}`);
          const key = emailKey(account.driver, account.email);
          if (key) pooledKeys.add(key);
        }
        pools.push({
          key: `${environmentId}:${source.id}:${provider.driver}`,
          driver: provider.driver,
          name: pooledInstanceName(provider),
          sourceLabel: labelEnvironment
            ? `${presentation.entry.target.label} · ${source.label}`
            : source.label,
          readableCount: pool.members.filter(
            (account) => limitsNotice(account.usageLimits) === null,
          ).length,
          windows,
          primary,
          members: pool.members.map((account) => {
            const identity = hubAccountLabel(account);
            const readable = limitsNotice(account.usageLimits) === null;
            return {
              key: `${source.id}:${account.id}`,
              identity,
              label: identity.split("@")[0] || identity,
              window: readable
                ? (primaryWindow(
                    sortWindows(account.usageLimits.windows.filter(isMainUsageWindow)),
                  ) ?? null)
                : null,
            };
          }),
        });
      }
    }
  }
  const accounts = collectLimitAccounts(presentations).filter(
    (account) =>
      !pooledKeys.has(account.key) &&
      !pooledKeys.has(emailKey(account.driver, account.email) ?? ""),
  );
  return { pools, accounts: sidebarUsageAccounts(accounts) };
}
