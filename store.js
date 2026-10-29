import pg from "pg";
import { readFileSync } from "node:fs";
import { RoomError, freshRoom } from "./room.js";
export class MemoryStore {
  mode = "memory";
  rooms = new Map();
  limits = new Map();
  async create(key, host, identity) {
    const now = Date.now();
    for (const [key, r] of this.rooms)
      if (r.expiresAt <= now) this.rooms.delete(key);
    for (const [key, l] of this.limits)
      if (l.until <= now) this.limits.delete(key);
    const limit = this.limits.get(identity) || {
      count: 0,
      until: now + 3600000,
    };
    if (limit.count >= 10 || this.rooms.size >= 1000)
      throw new RoomError(
        "Room creation limit reached. Try again later.",
        "limit",
      );
    limit.count++;
    this.limits.set(identity, limit);
    this.rooms.set(key, freshRoom(host, now));
  }
  async update(key, fn) {
    const r = this.rooms.get(key);
    if (!r)
      throw new RoomError(
        "Room not found or expired. Create a new shared space.",
        "expired",
      );
    const copy = structuredClone(r);
    fn(copy);
    this.rooms.set(key, copy);
    return copy;
  }
  async read(key) {
    const r = this.rooms.get(key);
    if (!r || r.expiresAt <= Date.now())
      throw new RoomError("Room expired.", "expired");
    return structuredClone(r);
  }
  async health() {
    return true;
  }
  async close() {}
}
export class PostgresStore {
  mode = "postgres";
  constructor(url) {
    this.pool = new pg.Pool({
      connectionString: url,
      max: 3,
      connectionTimeoutMillis: 8000,
      idleTimeoutMillis: 10000,
      statement_timeout: 5000,
      ssl: {
        rejectUnauthorized: true,
        ca: readFileSync(
          new URL("./certs/supabase-ca.crt", import.meta.url),
          "utf8",
        ),
      },
    });
    this.pool.on("error", () =>
      console.error(JSON.stringify({ event: "database_pool_error" })),
    );
  }
  async create(key, host, identity) {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      await c.query("select pg_advisory_xact_lock(7319381)");
      await c.query("delete from togetherplay.rooms where expires_at<now()");
      await c.query(
        "delete from togetherplay.creation_limits where resets_at<now()",
      );
      const quota = await c.query(
        `insert into togetherplay.creation_limits(identity,count,resets_at) values($1,1,now()+interval '1 hour') on conflict(identity) do update set count=creation_limits.count+1 returning count`,
        [identity],
      );
      const total = await c.query(
        "select count(*)::int as total from togetherplay.rooms",
      );
      if (quota.rows[0].count > 10 || total.rows[0].total >= 1000)
        throw new RoomError(
          "Room creation limit reached. Try again later.",
          "limit",
        );
      const r = freshRoom(host);
      await c.query(
        "insert into togetherplay.rooms(id,data,expires_at) values($1,$2,$3)",
        [key, r, new Date(r.expiresAt)],
      );
      await c.query("commit");
    } catch (e) {
      await c.query("rollback");
      throw e;
    } finally {
      c.release();
    }
  }
  async update(key, fn) {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      const { rows } = await c.query(
        "select data from togetherplay.rooms where id=$1 and expires_at>now() for update",
        [key],
      );
      if (!rows[0])
        throw new RoomError(
          "Room not found or expired. Create a new shared space.",
          "expired",
        );
      const r = rows[0].data;
      fn(r);
      await c.query("update togetherplay.rooms set data=$2 where id=$1", [
        key,
        r,
      ]);
      await c.query("commit");
      return r;
    } catch (e) {
      await c.query("rollback");
      throw e;
    } finally {
      c.release();
    }
  }
  async read(key) {
    const { rows } = await this.pool.query(
      "select data from togetherplay.rooms where id=$1 and expires_at>now()",
      [key],
    );
    if (!rows[0]) throw new RoomError("Room expired.", "expired");
    return rows[0].data;
  }
  async health() {
    await this.pool.query("select 1 from togetherplay.rooms limit 1");
    return true;
  }
  async close() {
    await this.pool.end();
  }
}
export function makeStore() {
  if (process.env.DATABASE_URL)
    return new PostgresStore(process.env.DATABASE_URL);
  if (process.env.VERCEL || process.env.NODE_ENV === "production")
    throw new Error("DATABASE_URL is required in production.");
  return new MemoryStore();
}
