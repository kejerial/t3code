import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { hasPendingMigrations, migrationManifest, runMigrations } from "../Migrations.ts";

const insertThread = (id: string, payload: Record<string, unknown>) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql`
      INSERT INTO orchestration_v2_projection_threads (
        thread_id, project_id, title, default_provider, runtime_mode, interaction_mode,
        created_at, updated_at, payload_json
      )
      VALUES (
        ${id}, 'project', ${id}, 'codex', 'full-access', 'default',
        '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z',
        ${JSON.stringify({ lineage: { relationshipToParent: null }, ...payload })}
      )
    `,
  );

const insertMessage = (id: string, threadId: string, createdAt: string, sender?: string) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql`
      INSERT INTO orchestration_v2_projection_messages (
        message_id, thread_id, run_id, node_id, role, streaming, created_at, updated_at, payload_json
      )
      VALUES (
        ${id}, ${threadId}, NULL, NULL, 'user', 0, ${createdAt}, ${createdAt},
        ${JSON.stringify(sender === undefined ? {} : { senderThreadId: sender })}
      )
    `,
  );

const launchers = Effect.flatMap(
  SqlClient.SqlClient,
  (sql) => sql<{ readonly id: string; readonly launcher: string | null }>`
    SELECT thread_id AS id, json_extract(payload_json, '$.launchedByThreadId') AS launcher
    FROM orchestration_v2_projection_threads
    ORDER BY thread_id
  `,
);

const launched = { createdBy: "agent", creationSource: "mcp" };

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))("fork 001_ThreadLaunchedBy", (it) => {
  it.effect("names the launcher of agent-launched threads from their first message", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 80 });
      yield* insertThread("parent", { createdBy: "user", creationSource: "web" });
      yield* insertThread("launched", launched);
      yield* insertMessage("launched-first", "launched", "2026-10-01T00:00:01.000Z", "parent");
      // A later message from another thread does not make it the launcher.
      yield* insertThread("sent-to-later", launched);
      yield* insertMessage("later-first", "sent-to-later", "2026-10-01T00:00:01.000Z");
      yield* insertMessage("later-second", "sent-to-later", "2026-10-01T00:00:02.000Z", "parent");
      yield* insertThread("user-made", { createdBy: "user", creationSource: "web" });
      yield* insertMessage("user-first", "user-made", "2026-10-01T00:00:01.000Z", "parent");
      yield* insertThread("subagent", {
        ...launched,
        lineage: { relationshipToParent: "subagent" },
      });
      yield* insertMessage("subagent-first", "subagent", "2026-10-01T00:00:01.000Z", "parent");
      yield* insertThread("launcher-gone", launched);
      yield* insertMessage(
        "gone-first",
        "launcher-gone",
        "2026-10-01T00:00:01.000Z",
        "deleted-thread",
      );

      yield* runMigrations();

      assert.deepEqual(
        (yield* launchers).filter((row) => row.launcher !== null),
        [{ id: "launched", launcher: "parent" }],
      );
    }),
  );
});

// Fork builds recorded ThreadLaunchedBy in upstream's ledger: first as 73, later as 81.
for (const legacyId of [73, 81]) {
  it.layer(Layer.fresh(NodeSqliteClient.layer({ filename: ":memory:" })))(
    `fork database that recorded ThreadLaunchedBy as ${legacyId}`,
    (it) => {
      it.effect("runs every upstream migration and does not run ThreadLaunchedBy again", () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* runMigrations({ toMigrationInclusive: legacyId - 1 });
          yield* sql`
            INSERT INTO effect_sql_migrations (migration_id, name, created_at)
            VALUES (${legacyId}, 'ThreadLaunchedBy', '2026-11-09 16:43:35')
          `;
          // ThreadLaunchedBy would name this launcher if it ran again.
          yield* insertThread("parent", { createdBy: "user", creationSource: "web" });
          yield* insertThread("launched", launched);
          yield* insertMessage("launched-first", "launched", "2026-10-01T00:00:01.000Z", "parent");

          yield* runMigrations();

          const upstream = yield* sql<{ readonly migration_id: number; readonly name: string }>`
            SELECT migration_id, name FROM effect_sql_migrations WHERE migration_id >= ${legacyId}
            ORDER BY migration_id
          `;
          assert.deepEqual(
            upstream.map((row) => `${row.migration_id}_${row.name}`),
            migrationManifest.filter(([id]) => id >= legacyId).map(([id, name]) => `${id}_${name}`),
          );
          const fork = yield* sql`SELECT migration_id, name, created_at FROM fork_sql_migrations`;
          assert.deepEqual(fork, [
            { migration_id: 1, name: "ThreadLaunchedBy", created_at: "2026-11-09 16:43:35" },
          ]);
          assert.deepEqual(
            (yield* launchers).filter((row) => row.launcher !== null),
            [],
          );
          assert.isFalse(yield* hasPendingMigrations());
        }),
      );
    },
  );
}
