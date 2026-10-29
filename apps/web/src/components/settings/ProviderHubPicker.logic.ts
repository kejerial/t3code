import type {
  ProviderInstanceConfig,
  UnifiedSettings,
  UsageLimitSourceId,
} from "@t3tools/contracts";

export const HUB_BASE_URL_VARIABLE = "ANTHROPIC_BASE_URL";
export const HUB_TOKEN_VARIABLE = "ANTHROPIC_AUTH_TOKEN";
const HUB_VARIABLES = new Set([HUB_BASE_URL_VARIABLE, HUB_TOKEN_VARIABLE]);

type HubSource = UnifiedSettings["usageLimitSources"][UsageLimitSourceId];

/** An empty key keeps a token already stored on the instance, so switching hubs needs no re-entry. */
export function routeInstanceThroughHub(
  instance: ProviderInstanceConfig,
  sourceId: UsageLimitSourceId,
  source: HubSource,
  accessKey: string,
): ProviderInstanceConfig {
  const existingToken = instance.environment?.find(
    (variable) => variable.name === HUB_TOKEN_VARIABLE,
  );
  const token = accessKey.trim()
    ? { name: HUB_TOKEN_VARIABLE, value: accessKey.trim(), sensitive: true }
    : existingToken;
  return {
    ...instance,
    usageLimitSourceId: sourceId,
    environment: [
      ...(instance.environment ?? []).filter((variable) => !HUB_VARIABLES.has(variable.name)),
      { name: HUB_BASE_URL_VARIABLE, value: source.url, sensitive: false },
      ...(token ? [token] : []),
    ],
  };
}

export function stopRoutingThroughHub(instance: ProviderInstanceConfig): ProviderInstanceConfig {
  const { usageLimitSourceId: _link, environment, ...rest } = instance;
  const kept = (environment ?? []).filter((variable) => !HUB_VARIABLES.has(variable.name));
  return kept.length > 0 ? { ...rest, environment: kept } : rest;
}

export function hasHubToken(instance: ProviderInstanceConfig): boolean {
  return (instance.environment ?? []).some(
    (variable) =>
      variable.name === HUB_TOKEN_VARIABLE &&
      (variable.valueRedacted === true || variable.value.length > 0),
  );
}
