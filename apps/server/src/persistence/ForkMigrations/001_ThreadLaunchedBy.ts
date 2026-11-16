import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Threads an agent launched before `launchedByThreadId` existed name the launcher only as the
  // sender of their first message.
  yield* sql`
    UPDATE orchestration_v2_projection_threads AS launched
    SET payload_json = json_set(launched.payload_json, '$.launchedByThreadId', (
      SELECT json_extract(first.payload_json, '$.senderThreadId')
      FROM orchestration_v2_projection_messages AS first
      WHERE first.thread_id = launched.thread_id
      ORDER BY first.created_at, first.message_id
      LIMIT 1
    ))
    WHERE json_extract(launched.payload_json, '$.createdBy') = 'agent'
      AND json_extract(launched.payload_json, '$.creationSource') = 'mcp'
      AND json_extract(launched.payload_json, '$.lineage.relationshipToParent') IS NULL
      AND json_extract(launched.payload_json, '$.launchedByThreadId') IS NULL
      AND EXISTS (
        SELECT 1
        FROM orchestration_v2_projection_threads AS launcher
        WHERE launcher.thread_id <> launched.thread_id
          AND launcher.thread_id = (
            SELECT json_extract(first.payload_json, '$.senderThreadId')
            FROM orchestration_v2_projection_messages AS first
            WHERE first.thread_id = launched.thread_id
            ORDER BY first.created_at, first.message_id
            LIMIT 1
          )
      )
  `;
});
