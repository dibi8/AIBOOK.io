const json = (data, init) => {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
};

const bad = (message, status = 400) => json({ ok: false, error: message }, { status });

const ensureTable = async (db) => {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS sync_store (sync_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)",
    )
    .run();
};

const isHex64 = (s) => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);

export async function onRequest(context) {
  const db = context.env && context.env.DB;
  if (!db) return bad("missing-db-binding", 500);

  const syncId = context.request.headers.get("x-sync-id") || "";
  if (!isHex64(syncId)) return bad("bad-sync-id", 400);

  await ensureTable(db);

  if (context.request.method === "GET") {
    const row = await db.prepare("SELECT payload, updated_at FROM sync_store WHERE sync_id = ?1").bind(syncId).first();
    if (!row) return bad("not-found", 404);
    return json({ ok: true, payload: row.payload, updated_at: row.updated_at }, { status: 200 });
  }

  if (context.request.method === "POST" || context.request.method === "PUT") {
    const body = await context.request.json().catch(() => null);
    if (!body || typeof body !== "object") return bad("bad-json", 400);

    const payload = body.payload;
    const updatedAt = body.updated_at;
    const prevUpdatedAt = body.prev_updated_at;

    if (typeof payload !== "string" || payload.length < 10) return bad("bad-payload", 400);
    if (typeof updatedAt !== "string" || updatedAt.length < 10) return bad("bad-updated_at", 400);
    if (typeof prevUpdatedAt !== "string") return bad("bad-prev_updated_at", 400);

    const existing = await db
      .prepare("SELECT payload, updated_at FROM sync_store WHERE sync_id = ?1")
      .bind(syncId)
      .first();

    if (existing && (!prevUpdatedAt || existing.updated_at !== prevUpdatedAt)) {
      return json({ ok: false, conflict: true, payload: existing.payload, updated_at: existing.updated_at }, { status: 409 });
    }

    await db
      .prepare(
        "INSERT INTO sync_store (sync_id, payload, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(sync_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
      )
      .bind(syncId, payload, updatedAt)
      .run();

    return json({ ok: true, updated_at: updatedAt }, { status: 200 });
  }

  return bad("method-not-allowed", 405);
}
