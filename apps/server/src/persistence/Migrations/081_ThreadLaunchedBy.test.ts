import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

const layer = it.layer(NodeSqliteClient.layer({ filename: ":memory:" }));

layer("081_ThreadLaunchedBy", (it) => {
  it.effect("names the launcher of agent-launched threads from their first message", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 80 });
      const thread = (id: string, payload: Record<string, unknown>) => sql`
        INSERT INTO orchestration_v2_projection_threads (
          thread_id, project_id, title, default_provider, runtime_mode, interaction_mode,
          created_at, updated_at, payload_json
        )
        VALUES (
          ${id}, 'project', ${id}, 'codex', 'full-access', 'default',
          '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z',
          ${JSON.stringify({ lineage: { relationshipToParent: null }, ...payload })}
        )
      `;
      const message = (id: string, threadId: string, createdAt: string, sender?: string) => sql`
        INSERT INTO orchestration_v2_projection_messages (
          message_id, thread_id, run_id, node_id, role, streaming, created_at, updated_at, payload_json
        )
        VALUES (
          ${id}, ${threadId}, NULL, NULL, 'user', 0, ${createdAt}, ${createdAt},
          ${JSON.stringify(sender === undefined ? {} : { senderThreadId: sender })}
        )
      `;
      const launched = { createdBy: "agent", creationSource: "mcp" };
      yield* thread("parent", { createdBy: "user", creationSource: "web" });
      yield* thread("launched", launched);
      yield* message("launched-first", "launched", "2026-10-01T00:00:01.000Z", "parent");
      // A later message from another thread does not make it the launcher.
      yield* thread("sent-to-later", launched);
      yield* message("later-first", "sent-to-later", "2026-10-01T00:00:01.000Z");
      yield* message("later-second", "sent-to-later", "2026-10-01T00:00:02.000Z", "parent");
      yield* thread("user-made", { createdBy: "user", creationSource: "web" });
      yield* message("user-first", "user-made", "2026-10-01T00:00:01.000Z", "parent");
      yield* thread("subagent", { ...launched, lineage: { relationshipToParent: "subagent" } });
      yield* message("subagent-first", "subagent", "2026-10-01T00:00:01.000Z", "parent");
      yield* thread("launcher-gone", launched);
      yield* message("gone-first", "launcher-gone", "2026-10-01T00:00:01.000Z", "deleted-thread");

      yield* runMigrations();

      const rows = yield* sql<{ readonly id: string; readonly launcher: string | null }>`
        SELECT thread_id AS id, json_extract(payload_json, '$.launchedByThreadId') AS launcher
        FROM orchestration_v2_projection_threads
        ORDER BY thread_id
      `;
      assert.deepEqual(
        rows.filter((row) => row.launcher !== null),
        [{ id: "launched", launcher: "parent" }],
      );
    }),
  );
});

it.layer(Layer.fresh(NodeSqliteClient.layer({ filename: ":memory:" })))(
  "081_ThreadLaunchedBy on a fork database",
  (it) => {
    it.effect("upgrades a fork database that recorded it as 73", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 72 });
        yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (73, 'ThreadLaunchedBy')`;

        yield* runMigrations();

        const recorded = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name FROM effect_sql_migrations WHERE migration_id >= 73
        ORDER BY migration_id
      `;
        assert.deepEqual(
          recorded.map((row) => `${row.migration_id}_${row.name}`),
          [
            "73_ActiveTurnItemIndexes",
            "74_ExcludeAttachmentPlaceholdersFromSearch",
            "75_SubagentDeliveryState",
            "76_ProjectionProjectsPinArchive",
            "77_RepairBooleanSettledOverride",
            "78_DropOrchestrationEventCorrelationIndex",
            "79_DelegatedRecoveryIndexes",
            "80_ScheduledTaskThreadMode",
            "81_ThreadLaunchedBy",
          ],
        );
      }),
    );
  },
);
