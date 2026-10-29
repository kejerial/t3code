import { useAtomValue } from "@effect/atom-react";
import type { ServerProvider, ServerProviderUsageWindow } from "@t3tools/contracts";
import { formatResetsIn, remainingPercent } from "@t3tools/shared/usageLimits";
import * as Schema from "effect/Schema";
import { ChevronRightIcon } from "lucide-react";
import { memo } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useNowMinute } from "../../hooks/useNowMinute";
import { usePrimarySettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { environmentPresentations } from "../../state/presentation";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { barColor } from "../usage/UsageLimits";
import {
  type SidebarUsageAccount,
  type SidebarUsagePool,
  sidebarUsage,
  usageTone,
} from "./SidebarUsageLimits.logic";

const SIDEBAR_USAGE_EXPANDED_KEY = "t3code:sidebar-usage-expanded";
const SIDEBAR_USAGE_POOL_MEMBERS_KEY = "t3code:sidebar-usage-pool-members-expanded";

const TONE_FILL = {
  warning: "var(--color-warning)",
  critical: "var(--color-destructive)",
} as const;

function fillColor(driver: ServerProvider["driver"], window: ServerProviderUsageWindow) {
  const tone = usageTone(window);
  return tone === "normal" ? barColor(driver) : TONE_FILL[tone];
}

function UsageBar({
  driver,
  window,
}: {
  readonly driver: ServerProvider["driver"];
  readonly window: ServerProviderUsageWindow;
}) {
  return (
    <div aria-hidden className="h-1 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full"
        style={{
          width: `${remainingPercent(window)}%`,
          backgroundColor: fillColor(driver, window),
        }}
      />
    </div>
  );
}

function WindowTooltip({
  window,
  now,
  children,
}: {
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
  readonly children: React.ReactElement;
}) {
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const resetsAt = window.resetsAt
    ? formatUpcomingTimestamp(window.resetsAt, timestampFormat, now)
    : null;
  const resetsIn = formatResetsIn(window, now);
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipPopup side="right">
        <div className="flex flex-col gap-0.5">
          <span className="text-foreground">
            {window.label}: {remainingPercent(window)}% left
          </span>
          {resetsAt ? (
            <span className="text-muted-foreground">
              Resets {resetsAt}
              {resetsIn ? ` · ${resetsIn}` : ""}
            </span>
          ) : null}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

function windowSummary(window: ServerProviderUsageWindow, now: number) {
  const resetsIn = formatResetsIn(window, now);
  return `${window.label}: ${remainingPercent(window)}% left${resetsIn ? `, ${resetsIn}` : ""}`;
}

function ExpandedAccount({
  account,
  now,
}: {
  readonly account: SidebarUsageAccount;
  readonly now: number;
}) {
  return (
    <li className="flex flex-col gap-1.5" data-testid="sidebar-usage-account">
      <Tooltip>
        <TooltipTrigger
          render={<span className="flex min-w-0 cursor-default items-baseline gap-1.5 text-xs" />}
        >
          <span
            aria-hidden
            className="size-1.5 shrink-0 self-center rounded-full"
            style={{ backgroundColor: barColor(account.driver) }}
          />
          <span className="shrink-0 font-medium text-sidebar-foreground">{account.provider}</span>
          <span className="truncate text-sidebar-muted-foreground">{account.identity}</span>
        </TooltipTrigger>
        <TooltipPopup side="right">
          {account.provider} · {account.identity}
        </TooltipPopup>
      </Tooltip>
      {account.windows.map((window) => (
        <WindowRow key={window.id} driver={account.driver} window={window} now={now} />
      ))}
    </li>
  );
}

function CollapsedAccount({
  account,
  now,
}: {
  readonly account: SidebarUsageAccount;
  readonly now: number;
}) {
  const window = account.primary;
  return (
    <li data-testid="sidebar-usage-account">
      <WindowTooltip window={window} now={now}>
        <div
          role="img"
          tabIndex={0}
          aria-label={`${account.provider} ${account.identity} · ${windowSummary(window, now)}`}
          className="flex cursor-default items-center gap-2 rounded-sm text-2xs leading-none tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
        >
          <span className="w-20 shrink-0 truncate text-sidebar-muted-foreground">
            {account.label}
          </span>
          <UsageBar driver={account.driver} window={window} />
          <span className="w-8 shrink-0 text-right font-medium text-sidebar-foreground">
            {remainingPercent(window)}%
          </span>
        </div>
      </WindowTooltip>
    </li>
  );
}

function poolDescription(pool: SidebarUsagePool) {
  return pool.readableCount > 1
    ? `Average of ${pool.readableCount} accounts on ${pool.sourceLabel}, weighted equally: the hub reports percent used, not plan size. Resets show the next account to reset.`
    : `Through ${pool.sourceLabel}.`;
}

function WindowRow({
  driver,
  window,
  now,
}: {
  readonly driver: ServerProvider["driver"];
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
}) {
  return (
    <WindowTooltip window={window} now={now}>
      <div
        role="img"
        tabIndex={0}
        aria-label={windowSummary(window, now)}
        className="flex cursor-default flex-col gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
      >
        <span className="flex items-baseline gap-1.5 text-2xs leading-none tabular-nums">
          <span className="truncate text-sidebar-muted-foreground">{window.label}</span>
          <span className="shrink-0 font-medium text-sidebar-foreground">
            {remainingPercent(window)}%
          </span>
          <span className="ms-auto shrink-0 text-sidebar-muted-foreground">
            {formatResetsIn(window, now)?.replace("resets in ", "") ?? ""}
          </span>
        </span>
        <UsageBar driver={driver} window={window} />
      </div>
    </WindowTooltip>
  );
}

function PoolMembers({ pool, now }: { readonly pool: SidebarUsagePool; readonly now: number }) {
  const [open, setOpen] = useLocalStorage(SIDEBAR_USAGE_POOL_MEMBERS_KEY, true, Schema.Boolean);
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex cursor-pointer items-center gap-1 self-start rounded-sm text-2xs leading-none text-sidebar-muted-foreground outline-none hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring/70"
        data-testid="sidebar-usage-pool-members-toggle"
      >
        <ChevronRightIcon
          aria-hidden
          className={cn("size-3 transition-transform", open && "rotate-90")}
        />
        {pool.members.length} {pool.members.length === 1 ? "account" : "accounts"}
      </button>
      {open ? (
        <ul className="flex flex-col gap-1 ps-4">
          {pool.members.map((member) => (
            <li key={member.key} data-testid="sidebar-usage-pool-member">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="flex cursor-default items-baseline gap-1.5 text-2xs leading-none tabular-nums" />
                  }
                >
                  <span className="min-w-0 truncate text-sidebar-muted-foreground">
                    {member.label}
                  </span>
                  <span className="ms-auto shrink-0 font-medium text-sidebar-foreground">
                    {member.window ? `${remainingPercent(member.window)}%` : "–"}
                  </span>
                  <span className="w-12 shrink-0 text-right text-sidebar-muted-foreground">
                    {member.window
                      ? (formatResetsIn(member.window, now)?.replace("resets in ", "") ?? "")
                      : ""}
                  </span>
                </TooltipTrigger>
                <TooltipPopup side="right">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-foreground">{member.identity}</span>
                    <span className="text-muted-foreground">
                      {member.window
                        ? windowSummary(member.window, now)
                        : "The hub could not read this account's usage."}
                    </span>
                  </div>
                </TooltipPopup>
              </Tooltip>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ExpandedPool({ pool, now }: { readonly pool: SidebarUsagePool; readonly now: number }) {
  return (
    <li className="flex flex-col gap-1.5" data-testid="sidebar-usage-pool">
      <Tooltip>
        <TooltipTrigger
          render={<span className="flex min-w-0 cursor-default items-baseline gap-1.5 text-xs" />}
        >
          <span
            aria-hidden
            className="size-1.5 shrink-0 self-center rounded-full"
            style={{ backgroundColor: barColor(pool.driver) }}
          />
          <span className="truncate font-medium text-sidebar-foreground">{pool.name}</span>
        </TooltipTrigger>
        <TooltipPopup side="right">{poolDescription(pool)}</TooltipPopup>
      </Tooltip>
      {pool.windows.map((window) => (
        <WindowRow key={window.id} driver={pool.driver} window={window} now={now} />
      ))}
      <PoolMembers pool={pool} now={now} />
    </li>
  );
}

function CollapsedPool({ pool, now }: { readonly pool: SidebarUsagePool; readonly now: number }) {
  const window = pool.primary;
  return (
    <li data-testid="sidebar-usage-pool">
      <WindowTooltip window={window} now={now}>
        <div
          role="img"
          tabIndex={0}
          aria-label={`${pool.name} · ${windowSummary(window, now)}`}
          className="flex cursor-default items-center gap-2 rounded-sm text-2xs leading-none tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
        >
          <span className="w-20 shrink-0 truncate text-sidebar-muted-foreground">{pool.name}</span>
          <UsageBar driver={pool.driver} window={window} />
          <span className="w-8 shrink-0 text-right font-medium text-sidebar-foreground">
            {remainingPercent(window)}%
          </span>
        </div>
      </WindowTooltip>
    </li>
  );
}

/** Quota for every account the environments report, hub-pooled and direct, below the thread list. */
export const SidebarUsageLimits = memo(function SidebarUsageLimits() {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const nowMinute = useNowMinute();
  const [expanded, setExpanded] = useLocalStorage(SIDEBAR_USAGE_EXPANDED_KEY, true, Schema.Boolean);
  const now = Date.parse(`${nowMinute}:00.000Z`);
  const { pools, accounts } = sidebarUsage(presentations, now);
  if (pools.length === 0 && accounts.length === 0) return null;
  const Account = expanded ? ExpandedAccount : CollapsedAccount;
  const Pool = expanded ? ExpandedPool : CollapsedPool;

  return (
    <section aria-label="Usage limits" className="mx-0.5 flex flex-col pb-1">
      <CollapsibleSectionHeader
        expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        data-testid="sidebar-usage-toggle"
      >
        Usage
      </CollapsibleSectionHeader>
      <ul className={cn("flex flex-col px-2", expanded ? "gap-3 pt-0.5" : "gap-1.5")}>
        {pools.map((pool) => (
          <Pool key={pool.key} pool={pool} now={now} />
        ))}
        {accounts.map((account) => (
          <Account key={account.key} account={account} now={now} />
        ))}
      </ul>
    </section>
  );
});
