import type { EnvironmentId, UsageLimitsReport } from "@t3tools/contracts";
import {
  formatResetsIn,
  isMainUsageWindow,
  limitsNotice,
  remainingPercent,
} from "@t3tools/shared/usageLimits";
import { Pressable, ScrollView, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { AccountLimits, ResetCredits } from "../usage/UsageLimitsSection";

const DRIVER_LABEL: Partial<Record<string, string>> = { codex: "Codex", claudeAgent: "Claude" };

type PoolMember = NonNullable<UsageLimitsReport["accounts"][number]["pool"]>["members"][number];

function PoolMembers({
  members,
  now,
}: {
  readonly members: readonly PoolMember[];
  readonly now: number;
}) {
  const readable = members.filter((member) => limitsNotice(member.limits) === null).length;
  return (
    <View className="gap-1 pt-1">
      {readable > 1 ? (
        <Text className="text-xs text-foreground-tertiary">
          Average of {readable} accounts, weighted equally: the hub reports percent used, not plan
          size.
        </Text>
      ) : null}
      {members.map((member) => {
        const windows = member.limits.windows.filter(isMainUsageWindow);
        const weekly = windows.find((window) => window.kind === "weekly") ?? windows[0];
        const readableWeekly = limitsNotice(member.limits) === null ? weekly : undefined;
        return (
          <View key={member.label} className="flex-row items-baseline gap-2">
            <Text className="min-w-0 flex-1 text-xs text-foreground-muted" numberOfLines={1}>
              {member.label}
            </Text>
            <Text className="text-xs tabular-nums text-foreground">
              {readableWeekly ? `${remainingPercent(readableWeekly)}% left` : "–"}
            </Text>
            <Text className="w-24 text-right text-xs tabular-nums text-foreground-tertiary">
              {readableWeekly ? (formatResetsIn(readableWeekly, now) ?? "") : ""}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function ComposerUsageLimits({
  report,
  environmentId,
  maxHeight,
  onClose,
}: {
  readonly report: UsageLimitsReport;
  readonly environmentId: EnvironmentId;
  readonly maxHeight: number;
  readonly onClose: () => void;
}) {
  const now = Date.parse(report.createdAt);
  const close = (
    <Pressable
      accessibilityLabel="Dismiss usage limits"
      accessibilityRole="button"
      hitSlop={12}
      onPress={onClose}
      className="-me-1 p-1 active:opacity-60"
    >
      <SymbolView name="xmark" size={14} tintColorClassName="accent-icon-muted" type="monochrome" />
    </Pressable>
  );
  return (
    <View className="overflow-hidden rounded-[20px] border-continuous bg-card">
      <ScrollView bounces={false} showsVerticalScrollIndicator={false} style={{ maxHeight }}>
        {report.accounts.map((account, index) => {
          const resetCreditInput =
            account.resetCreditInput ??
            (account.instanceId ? { instanceId: account.instanceId } : undefined);
          const driverLabel = DRIVER_LABEL[account.driver] ?? String(account.driver);
          return (
            <AccountLimits
              key={account.id}
              dense
              first={index === 0}
              driver={account.driver}
              label={driverLabel}
              instanceLabel={
                account.instanceId
                  ? account.displayName?.trim() ||
                    (String(account.instanceId) !== String(account.driver)
                      ? account.instanceId
                      : driverLabel)
                  : account.label
              }
              detail={account.plan}
              limits={account.limits}
              now={now}
              trailing={index === 0 ? close : undefined}
              footer={
                account.pool ? (
                  <PoolMembers members={account.pool.members} now={now} />
                ) : resetCreditInput && account.limits.resetCredits ? (
                  <ResetCredits
                    dense
                    environmentId={environmentId}
                    input={resetCreditInput}
                    credits={account.limits.resetCredits}
                    now={now}
                  />
                ) : undefined
              }
            />
          );
        })}
        {report.accounts.length === 0 ? (
          <View className="flex-row items-center gap-3 px-4 pt-3">
            <Text className="min-w-0 flex-1 text-base text-foreground">Usage limits</Text>
            {close}
          </View>
        ) : null}
        {report.notices.map((notice) => (
          <Text
            key={notice}
            className={
              report.accounts.length === 0
                ? "px-4 py-3 text-xs text-foreground-muted"
                : "border-t border-border-subtle px-4 py-3 text-xs text-foreground-muted"
            }
          >
            {notice}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}
