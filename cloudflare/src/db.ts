export interface Friend { id: number; token: string; name: string }
export interface Profile {
  id: number; friend_id: number; name: string; email: string | null; plate: string | null;
  state: string | null; make: string | null; model: string | null; color: string | null;
}
export interface Job {
  id: number; friend_id: number; plate: string; state: string; make: string; model: string; color: string;
  email: string; start_ts: number; end_ts: number; expires_ts: number | null; last_ok_ts: number | null;
  status: string; fails: number; error: string | null; confirmation: string | null; qr_path: string | null;
  who: string | null; next_try: number | null;
}

// Every column except the QR bytes, so lists stay small. has_qr says whether a QR is stored.
export const JOB_COLS = "id,friend_id,plate,state,make,model,color,email,start_ts,end_ts,expires_ts,last_ok_ts," +
  "status,fails,error,confirmation,qr_path,who,next_try,(qr_png IS NOT NULL) AS has_qr";

export async function friendByToken(db: D1Database, token: string): Promise<Friend | null> {
  return db.prepare("SELECT * FROM friends WHERE token=?").bind(token).first<Friend>();
}

export async function getJob(db: D1Database, id: number): Promise<(Job & { has_qr: number }) | null> {
  return db.prepare(`SELECT ${JOB_COLS} FROM jobs WHERE id=?`).bind(id).first();
}

/** One-row lock with an expiry, so two cron ticks never drive the browser at once. */
export async function takeLock(db: D1Database, name: string, owner: string, t: number, ttl: number): Promise<boolean> {
  const r = await db.prepare(
    "INSERT INTO meta(key,value,until) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, " +
    "until=excluded.until WHERE meta.until IS NULL OR meta.until < ?",
  ).bind(name, owner, t + ttl, t).run();
  return (r.meta.changes ?? 0) > 0;
}

export async function dropLock(db: D1Database, name: string, owner: string): Promise<void> {
  await db.prepare("DELETE FROM meta WHERE key=? AND value=?").bind(name, owner).run();
}

export async function getMeta(db: D1Database, key: string): Promise<string | null> {
  const r = await db.prepare("SELECT value FROM meta WHERE key=?").bind(key).first<{ value: string }>();
  return r ? r.value : null;
}

export async function setMeta(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(key, value).run();
}
