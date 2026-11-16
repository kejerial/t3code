import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

import ForkMigration0001 from "./ForkMigrations/001_ThreadLaunchedBy.ts";

// This fork's migrations keep their own ledger and run after upstream's. Upstream can then take
// any id in effect_sql_migrations, which the Migrator skips through its highest recorded id.
const FORK_MIGRATIONS_TABLE = "fork_sql_migrations";

const forkMigrationEntries = [[1, "ThreadLaunchedBy", ForkMigration0001]] as const;

interface MigrationRow {
  readonly id: number;
  readonly name: string;
}

// Fork builds recorded these in upstream's ledger before the fork ledger existed.
const LEGACY_FORK_ROWS = [
  { id: 73, name: "ThreadLaunchedBy", forkId: 1 },
  { id: 81, name: "ThreadLaunchedBy", forkId: 1 },
];

const legacyForkRow = (row: MigrationRow) =>
  LEGACY_FORK_ROWS.find((legacy) => legacy.id === row.id && legacy.name === row.name);

/** Upstream's ledger as startup leaves it once the fork rows move to the fork ledger. */
export const withoutLegacyForkRows = <T extends MigrationRow>(history: ReadonlyArray<T>) =>
  history.filter((row) => legacyForkRow(row) === undefined);

const latestForkMigrationId = Math.max(...forkMigrationEntries.map(([id]) => id));

const tableExists = Effect.fn("tableExists")(function* (name: string) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ${name}`;
  return rows.length > 0;
});

export const hasPendingForkMigrations = Effect.fn("hasPendingForkMigrations")(function* () {
  const sql = yield* SqlClient.SqlClient;
  if (!(yield* tableExists(FORK_MIGRATIONS_TABLE))) return true;
  const [row] = yield* sql<{ readonly latestId: number | null }>`
    SELECT MAX(migration_id) AS latestId FROM ${sql(FORK_MIGRATIONS_TABLE)}
  `;
  return (row?.latestId ?? 0) < latestForkMigrationId;
});

/** Moves fork rows out of upstream's ledger into the fork ledger, keeping when each ran. */
export const adoptLegacyForkMigrations = Effect.fn("adoptLegacyForkMigrations")(function* () {
  const sql = yield* SqlClient.SqlClient;
  if (!(yield* tableExists("effect_sql_migrations"))) return;
  const recorded = yield* sql<{
    readonly migration_id: number;
    readonly name: string;
    readonly created_at: string;
  }>`SELECT migration_id, name, created_at FROM effect_sql_migrations`;
  const legacy = recorded.flatMap((row) => {
    const match = legacyForkRow({ id: row.migration_id, name: row.name });
    return match === undefined ? [] : [{ ...match, createdAt: row.created_at }];
  });
  if (legacy.length === 0) return;
  yield* sql.withTransaction(
    Effect.gen(function* () {
      // The Migrator's own SQLite ledger schema, so its later CREATE IF NOT EXISTS is a no-op.
      yield* sql`
        CREATE TABLE IF NOT EXISTS ${sql(FORK_MIGRATIONS_TABLE)} (
          migration_id integer PRIMARY KEY NOT NULL,
          created_at datetime NOT NULL DEFAULT current_timestamp,
          name VARCHAR(255) NOT NULL
        )
      `;
      for (const row of legacy) {
        yield* sql`
          INSERT OR IGNORE INTO ${sql(FORK_MIGRATIONS_TABLE)} (migration_id, name, created_at)
          VALUES (${row.forkId}, ${row.name}, ${row.createdAt})
        `;
        yield* sql`
          DELETE FROM effect_sql_migrations WHERE migration_id = ${row.id} AND name = ${row.name}
        `;
      }
    }),
  );
});

const run = Migrator.make({});

export const runForkMigrations = Effect.fn("runForkMigrations")(function* () {
  return yield* run({
    loader: Migrator.fromRecord(
      Object.fromEntries(
        forkMigrationEntries.map(([id, name, migration]) => [`${id}_${name}`, migration]),
      ),
    ),
    table: FORK_MIGRATIONS_TABLE,
  });
});
