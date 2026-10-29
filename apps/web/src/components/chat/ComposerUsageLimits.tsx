import type { EnvironmentId, UsageLimitsReport } from "@t3tools/contracts";
import {
  formatResetsIn,
  isMainUsageWindow,
  limitsNotice,
  remainingPercent,
} from "@t3tools/shared/usageLimits";
import { ChevronRightIcon, GaugeIcon } from "lucide-react";
import { useState } from "react";

import { ensureLocalApi } from "../../localApi";
import { Button } from "../ui/button";
import { providerClients } from "../settings/providerDriverMeta";
import { RedactedSensitiveText } from "../settings/RedactedSensitiveText";
import { LimitWindows, ResetCredits } from "../usage/UsageLimits";
import { cn } from "../../lib/utils";
import { ComposerBanner } from "./ComposerBanner";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";

function accountLabel(account: UsageLimitsReport["accounts"][number]): string {
  if (!account.instanceId) return account.label;
  const driver = providerClients.get(account.driver)?.label ?? String(account.driver);
  const instance =
    account.displayName?.trim() ||
    (String(account.instanceId) !== String(account.driver) ? account.instanceId : "");
  return instance && instance.toLowerCase() !== driver.toLowerCase()
    ? `${driver} · ${instance}`
    : driver;
}

function AccountSummary({ account }: { readonly account: UsageLimitsReport["accounts"][number] }) {
  const label = accountLabel(account);
  return (
    <>
      {label.includes("@") ? (
        <RedactedSensitiveText
          key={label}
          value={label}
          ariaLabel="Toggle account label visibility"
          revealTooltip="Click to reveal account"
          hideTooltip="Click to hide account"
          className="max-w-full truncate align-bottom font-sans text-xs leading-normal"
        />
      ) : (
        label
      )}
      {account.plan ? ` · ${account.plan}` : null}
    </>
  );
}

export function usageLimitsBannerItem(
  id: string,
  report: UsageLimitsReport,
  environmentId: EnvironmentId,
  onDismiss: () => void,
): ComposerBannerStackItem {
  const [first] = report.accounts;
  const single = report.accounts.length === 1 && first ? first : null;
  const summary = single ? (
    <AccountSummary account={single} />
  ) : (
    `${report.accounts.length} accounts`
  );
  return {
    id,
    variant: "info",
    icon: <GaugeIcon />,
    title: "Usage limits",
    description: summary,
    dismissLabel: "Dismiss usage limits",
    onDismiss,
    children: <UsageLimitsBannerBody report={report} environmentId={environmentId} />,
  };
}

type PoolMember = NonNullable<UsageLimitsReport["accounts"][number]["pool"]>["members"][number];

function PoolMembers({
  members,
  now,
}: {
  readonly members: readonly PoolMember[];
  readonly now: number;
}) {
  const [open, setOpen] = useState(false);
  const readable = members.filter((member) => limitsNotice(member.limits) === null).length;
  return (
    <div className="flex flex-col gap-1 text-xs">
      {readable > 1 ? (
        <span className="text-muted-foreground">
          Average of {readable} accounts, weighted equally: the hub reports percent used, not plan
          size.
        </span>
      ) : null}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex cursor-pointer items-center gap-1 self-start rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/70"
      >
        <ChevronRightIcon aria-hidden className={cn("size-3", open && "rotate-90")} />
        {members.length} {members.length === 1 ? "account" : "accounts"}
      </button>
      {open ? (
        <ul className="flex flex-col gap-0.5 ps-4 tabular-nums">
          {members.map((member) => {
            const windows = member.limits.windows.filter(isMainUsageWindow);
            const weekly = windows.find((window) => window.kind === "weekly") ?? windows[0];
            const notice = limitsNotice(member.limits);
            return (
              <li key={member.label} className="flex min-w-0 items-baseline gap-2">
                <span className="min-w-0 truncate text-muted-foreground">{member.label}</span>
                <span className="ms-auto shrink-0 text-foreground">
                  {notice || !weekly ? "–" : `${remainingPercent(weekly)}% left`}
                </span>
                <span className="w-24 shrink-0 text-right text-muted-foreground">
                  {weekly && !notice ? (formatResetsIn(weekly, now) ?? "") : ""}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function UsageLimitsBannerBody({
  report,
  environmentId,
}: {
  readonly report: UsageLimitsReport;
  readonly environmentId: EnvironmentId;
}) {
  const now = Date.parse(report.createdAt);
  return (
    <ComposerBanner.Scroll>
      <ComposerBanner.Body className="flex flex-col gap-2 pt-1 pb-1.5 pe-2">
        {report.accounts.map((account) => {
          const resetCreditInput =
            account.resetCreditInput ??
            (account.instanceId ? { instanceId: account.instanceId } : undefined);
          const notice = limitsNotice(account.limits);
          const externalUsage = account.limits.externalUsage;
          return (
            <div key={account.id} className="flex min-w-0 flex-col gap-1">
              {report.accounts.length > 1 ? (
                <span className="truncate text-xs text-muted-foreground">
                  <AccountSummary account={account} />
                </span>
              ) : null}
              {notice ? (
                <span className="text-xs text-muted-foreground">{notice}</span>
              ) : (
                <LimitWindows
                  compact
                  driver={account.driver}
                  windows={account.limits.windows}
                  now={now}
                />
              )}
              {account.pool ? <PoolMembers members={account.pool.members} now={now} /> : null}
              {externalUsage ? (
                <Button
                  size="sm"
                  variant="link"
                  className="self-start"
                  onClick={() => void ensureLocalApi().shell.openExternal(externalUsage.url)}
                >
                  Manage usage
                </Button>
              ) : null}
              {resetCreditInput && account.limits.resetCredits ? (
                <ResetCredits
                  environmentId={environmentId}
                  input={resetCreditInput}
                  credits={account.limits.resetCredits}
                  now={now}
                />
              ) : null}
            </div>
          );
        })}
        {report.notices.map((notice) => (
          <span key={notice} className="text-xs text-muted-foreground">
            {notice}
          </span>
        ))}
      </ComposerBanner.Body>
    </ComposerBanner.Scroll>
  );
}
