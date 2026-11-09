import type { ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import { type ProviderInstanceEntry } from "../../providerInstances";
import { getDisplayModelName, type ModelEsque } from "./providerIconUtils";

export function providerSupportsManualCompaction(
  provider: ProviderInstanceEntry | null | undefined,
): boolean {
  return provider?.snapshot.slashCommands.some((command) => command.name === "compact") ?? false;
}

export function resolveContextWindowModelDisplayName(
  selection: ModelSelection | null | undefined,
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>,
): string | null {
  if (!selection) {
    return null;
  }

  const selectedModel = modelOptionsByInstance
    .get(selection.instanceId)
    ?.find((model) => model.slug === selection.model);

  return selectedModel ? getDisplayModelName(selectedModel) : selection.model;
}

export function formatContextWindowCompactionMessage(
  modelDisplayName: string | null | undefined,
  autoCompactThreshold?: number | null,
): string {
  if (typeof autoCompactThreshold === "number" && autoCompactThreshold > 0) {
    return `Compacts automatically at about ${autoCompactThreshold.toLocaleString("en-US")} tokens.`;
  }
  return modelDisplayName
    ? `Context for ${modelDisplayName} compacts automatically when needed.`
    : "Context compacts automatically when needed.";
}

export function formatContextWindowCost(cost: {
  readonly amount: number;
  readonly currency: string;
}): string {
  const fractionDigits = Math.abs(cost.amount) > 0 && Math.abs(cost.amount) < 0.01 ? 4 : 2;
  return `${cost.currency} ${cost.amount.toFixed(fractionDigits)}`;
}

export type ContextBarTone = "ok" | "warn" | "danger";

/** Fill against the auto-compact point when known, since that is where the thread actually resets. */
export function resolveContextBarFill(usage: {
  readonly usedTokens: number;
  readonly maxTokens?: number | null | undefined;
  readonly autoCompactThreshold?: number | null | undefined;
}): {
  readonly limit: number;
  readonly share: number;
  readonly tone: ContextBarTone;
  readonly limitIsCompact: boolean;
} | null {
  const compactAt = usage.autoCompactThreshold ?? null;
  const limitIsCompact =
    compactAt !== null && compactAt > 0 && (usage.maxTokens == null || compactAt < usage.maxTokens);
  const limit = limitIsCompact ? compactAt : (usage.maxTokens ?? null);
  if (limit === null || limit <= 0) return null;
  const share = Math.min(1, Math.max(0, usage.usedTokens / limit));
  const tone: ContextBarTone = share >= 0.85 ? "danger" : share >= 0.6 ? "warn" : "ok";
  return { limit, share, tone, limitIsCompact };
}
