import { useAtomValue } from "@effect/atom-react";
import type { ServerProvider, ServerProviderUsageWindow } from "@t3tools/contracts";
import {
  collectLimitAccounts,
  formatResetsIn,
  remainingPercent,
} from "@t3tools/shared/usageLimits";
import * as Schema from "effect/Schema";
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
  sidebarUsageAccounts,
  usageTone,
} from "./SidebarUsageLimits.logic";

const SIDEBAR_USAGE_EXPANDED_KEY = "t3code:sidebar-usage-expanded";

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
          <span className="truncate font-medium text-sidebar-foreground">{account.label}</span>
          {account.plan ? (
            <span className="truncate text-sidebar-muted-foreground">{account.plan}</span>
          ) : null}
        </TooltipTrigger>
        <TooltipPopup side="right">{account.title}</TooltipPopup>
      </Tooltip>
      {account.windows.map((window) => (
        <WindowTooltip key={window.id} window={window} now={now}>
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
                {formatResetsIn(window, now) ?? ""}
              </span>
            </span>
            <UsageBar driver={account.driver} window={window} />
          </div>
        </WindowTooltip>
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
          aria-label={`${account.title} · ${windowSummary(window, now)}`}
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

/** Quota for every account the environments report, hub-pooled and direct, below the thread list. */
export const SidebarUsageLimits = memo(function SidebarUsageLimits() {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const nowMinute = useNowMinute();
  const [expanded, setExpanded] = useLocalStorage(SIDEBAR_USAGE_EXPANDED_KEY, true, Schema.Boolean);
  const accounts = sidebarUsageAccounts(collectLimitAccounts(presentations));
  if (accounts.length === 0) return null;
  const now = Date.parse(`${nowMinute}:00.000Z`);
  const Account = expanded ? ExpandedAccount : CollapsedAccount;

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
        {accounts.map((account) => (
          <Account key={account.key} account={account} now={now} />
        ))}
      </ul>
    </section>
  );
});
