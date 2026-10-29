import type {
  ProviderInstanceConfig,
  UnifiedSettings,
  UsageLimitSourceId,
} from "@t3tools/contracts";
import { useState } from "react";

import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import {
  HUB_BASE_URL_VARIABLE,
  HUB_TOKEN_VARIABLE,
  hasHubToken,
  routeInstanceThroughHub,
  stopRoutingThroughHub,
} from "./ProviderHubPicker.logic";
import { SecretInput } from "./SecretInput";
import { SettingsRow } from "./settingsLayout";

function hubLabel(source: { readonly label?: string | undefined; readonly url: string }) {
  if (source.label) return source.label;
  try {
    return new URL(source.url).host || source.url;
  } catch {
    return source.url;
  }
}

/** Routes a Claude instance through a CLIProxyAPI hub so the hub picks the account per request. */
export function ProviderHubPicker({
  instance,
  sources,
  readOnly = false,
  onChange,
}: {
  readonly instance: ProviderInstanceConfig;
  readonly sources: UnifiedSettings["usageLimitSources"];
  readonly readOnly?: boolean;
  readonly onChange: (next: ProviderInstanceConfig) => void;
}) {
  const hubs = Object.entries(sources) as Array<
    [UsageLimitSourceId, UnifiedSettings["usageLimitSources"][UsageLimitSourceId]]
  >;
  const linkedId = instance.usageLimitSourceId;
  const linked = linkedId ? sources[linkedId] : undefined;
  const [selectedId, setSelectedId] = useState<UsageLimitSourceId | null>(hubs[0]?.[0] ?? null);
  const [accessKey, setAccessKey] = useState("");
  const selected = hubs.find(([id]) => id === selectedId);
  const keyStored = hasHubToken(instance);

  if (linkedId) {
    return (
      <SettingsRow
        title="Hub"
        description={
          linked ? (
            <>
              Requests go through {hubLabel(linked)} at <code>{linked.url}</code>. The hub picks the
              account; usage shows its pooled quota.
            </>
          ) : (
            "The hub this instance used was removed. Stop using it, or add the hub again."
          )
        }
        control={
          <Button
            size="sm"
            variant="outline"
            disabled={readOnly}
            onClick={() => onChange(stopRoutingThroughHub(instance))}
          >
            Stop using hub
          </Button>
        }
      />
    );
  }

  if (hubs.length === 0) {
    return (
      <SettingsRow
        title="Route through a hub"
        description="Add a CLIProxyAPI hub under Usage providers first. This instance can then send its requests through it and show the hub's pooled quota."
      />
    );
  }

  const canUse = selected !== undefined && (accessKey.trim().length > 0 || keyStored);
  return (
    <SettingsRow
      title="Route through a hub"
      description={
        <>
          Send requests through a CLIProxyAPI hub, which picks the account. This sets{" "}
          <code>{HUB_BASE_URL_VARIABLE}</code> and stores the hub access key (an entry under{" "}
          <code>api-keys</code> in its config, not the management key) as a sensitive{" "}
          <code>{HUB_TOKEN_VARIABLE}</code>.
        </>
      }
    >
      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2 pb-2">
        <Select
          value={selectedId ?? ""}
          disabled={readOnly}
          onValueChange={(value) => {
            if (value !== null) setSelectedId(value as UsageLimitSourceId);
          }}
        >
          <SelectTrigger aria-label="Hub" className="min-w-40" size="sm">
            <SelectValue>{selected ? hubLabel(selected[1]) : "Choose a hub"}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {hubs.map(([id, source]) => (
              <SelectItem key={id} value={id}>
                {hubLabel(source)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <SecretInput
          size="sm"
          className="min-w-0 flex-1"
          aria-label="Hub access key"
          placeholder="Hub access key"
          configured={keyStored}
          disabled={readOnly}
          value={accessKey}
          onChange={(event) => setAccessKey(event.target.value)}
        />
        <Button
          size="sm"
          disabled={readOnly || !canUse}
          onClick={() => {
            if (!selected) return;
            onChange(routeInstanceThroughHub(instance, selected[0], selected[1], accessKey));
            setAccessKey("");
          }}
        >
          Use hub
        </Button>
      </div>
    </SettingsRow>
  );
}
