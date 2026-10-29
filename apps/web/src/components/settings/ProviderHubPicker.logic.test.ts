import { ProviderDriverKind, UsageLimitSourceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { routeInstanceThroughHub, stopRoutingThroughHub } from "./ProviderHubPicker.logic";

const hub = {
  kind: "cliproxy" as const,
  url: "http://127.0.0.1:8317",
  managementKey: "",
  enabled: true,
};
const instance = {
  driver: ProviderDriverKind.make("claudeAgent"),
  environment: [
    { name: "CLAUDE_CODE_ENABLE_TODO_TOOLS", value: "1", sensitive: false },
    { name: "ANTHROPIC_BASE_URL", value: "https://old.example", sensitive: false },
  ],
};

describe("hub routing", () => {
  it("sets the hub URL, a sensitive access key, and the link, and removes all three on the way out", () => {
    const routed = routeInstanceThroughHub(instance, UsageLimitSourceId.make("hub"), hub, " key ");
    expect(routed.usageLimitSourceId).toBe("hub");
    expect(routed.environment).toEqual([
      { name: "CLAUDE_CODE_ENABLE_TODO_TOOLS", value: "1", sensitive: false },
      { name: "ANTHROPIC_BASE_URL", value: "http://127.0.0.1:8317", sensitive: false },
      { name: "ANTHROPIC_AUTH_TOKEN", value: "key", sensitive: true },
    ]);
    expect(stopRoutingThroughHub(routed)).toEqual({
      driver: instance.driver,
      environment: [{ name: "CLAUDE_CODE_ENABLE_TODO_TOOLS", value: "1", sensitive: false }],
    });
  });

  it("keeps a stored access key when switching hubs without entering a new one", () => {
    const stored = {
      ...instance,
      environment: [
        { name: "ANTHROPIC_AUTH_TOKEN", value: "", sensitive: true, valueRedacted: true },
      ],
    };
    const routed = routeInstanceThroughHub(stored, UsageLimitSourceId.make("other"), hub, "");
    expect(routed.environment).toContainEqual(stored.environment[0]);
  });
});
