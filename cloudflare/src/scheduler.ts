// The renewal job, ported from the Flask app's scheduler() and run_registration().
// Cron runs tick() every minute. Rules are unchanged:
// - a permit lasts 24 h, renew once it has run out and more than 30 minutes of the stay remain
// - otherwise mark the job done once the last permit has run out
// - a failure retries 10 minutes later, up to 5 tries, emailing on the 1st and the 5th
import { dropLock, getJob, takeLock, type Job } from "./db";
import type { Driver, Result } from "./driver";
import { failureMail, successMail } from "./emails";
import type { Env } from "./env";
import { placeOf } from "./env";
import { pyTitle } from "./page";
import { now as clockNow } from "./time";
import type { Mail } from "./emails";

export const RETRY_AFTER = 600;
export const MAX_FAILS = 5;
const LOCK_TTL = 14 * 60;          // a cron run may last 15 minutes
const STOP_STARTING_AFTER = 11 * 60; // leave room to finish the last run inside one cron event

export interface TickDeps {
  driver: Driver;
  send: (m: Mail) => Promise<boolean>;
  now?: () => number;
  /** Returns false when the daily browser allowance is used up. */
  canLaunch?: () => Promise<boolean>;
}

function moreDays(j: Pick<Job, "expires_ts" | "end_ts">): boolean {
  return j.expires_ts === null || (j.end_ts - j.expires_ts) > 1800; // a permit lasts 24h; ignore a short tail
}

/** Register once for a job, update the row, and email the result. Same as run_registration(). */
export async function runRegistration(env: Env, deps: TickDeps, jobId: number): Promise<void> {
  const now = deps.now ?? clockNow;
  const j = await getJob(env.DB, jobId);
  if (!j || !["pending", "active"].includes(j.status)) return;
  if (j.expires_ts && now() < j.expires_ts) return; // still covered, nothing to do
  const first = j.last_ok_ts === null;
  const owner = await env.DB.prepare("SELECT property, unit FROM friends WHERE id=?").bind(j.friend_id)
    .first<{ property: string | null; unit: string | null }>();
  const { property, unit } = placeOf(env, owner ?? {});
  // No place to register at (page has none and no fallback is set): count it as a failed try.
  const r: Result = !property || !unit ? { ok: false, message: "This page has no property or unit set." }
    : await deps.driver.register({
      vehicle: { plate: j.plate, state: j.state, make: j.make, model: j.model, color: j.color },
      email: j.email, property, unit,
    });
  const t = now();
  // A "Done staying" press while the browser ran wins: only update a row that is still live.
  if (r.ok) {
    await env.DB.prepare("UPDATE jobs SET status='active', fails=0, error=NULL, next_try=NULL, last_ok_ts=?, " +
      "expires_ts=?, confirmation=?, qr_png=? WHERE id=? AND status IN ('pending','active')")
      .bind(t, r.expires_ts || t + 86400, r.confirmation ?? null, r.qr ?? null, jobId).run();
  } else {
    const fails = j.fails + 1;
    const gaveUp = fails >= MAX_FAILS;
    const status = gaveUp ? "failed" : (j.last_ok_ts ? "active" : "pending");
    await env.DB.prepare("UPDATE jobs SET fails=?, error=?, status=?, next_try=? WHERE id=? AND status IN ('pending','active')")
      .bind(fails, r.message, status, t + RETRY_AFTER, jobId).run();
  }
  const place = `${pyTitle(property)}, unit ${unit}`;
  if (r.ok) {
    const fresh = await getJob(env.DB, jobId);
    if (fresh) await deps.send(successMail(fresh, first, r.qr ?? null, place));
  } else if ([1, MAX_FAILS].includes(j.fails + 1)) {
    await deps.send(failureMail(j, first, r.message, j.fails + 1 >= MAX_FAILS));
  }
}

export interface TickReport { ran: number[]; done: number[]; skipped: string | null }

/** One scheduler pass. Same decisions as the Flask scheduler loop body. */
export async function tick(env: Env, deps: TickDeps): Promise<TickReport> {
  const now = deps.now ?? clockNow;
  const report: TickReport = { ran: [], done: [], skipped: null };
  const owner = crypto.randomUUID();
  const started = now();
  if (!(await takeLock(env.DB, "tick_lock", owner, started, LOCK_TTL))) {
    report.skipped = "another run is still working";
    return report;
  }
  try {
    const { results: jobs } = await env.DB.prepare(
      "SELECT id,end_ts,expires_ts,next_try FROM jobs WHERE status IN ('pending','active') ORDER BY id",
    ).all<Pick<Job, "id" | "end_ts" | "expires_ts" | "next_try">>();
    const t = now();
    for (const j of jobs) {
      const exp = j.expires_ts;
      const more = moreDays(j);
      if (exp !== null && t >= exp && !more) {
        await env.DB.prepare("UPDATE jobs SET status='done' WHERE id=?").bind(j.id).run();
        report.done.push(j.id);
      } else if (more && (exp === null || t >= exp) && t >= (j.next_try || 0)) {
        if (env.PAUSE_REGISTRATIONS === "1") {
          report.skipped = "registrations are paused (PAUSE_REGISTRATIONS=1)";
          continue;
        }
        if (now() - started > STOP_STARTING_AFTER) {
          report.skipped = "out of time in this run, the next run continues";
          continue;
        }
        if (deps.canLaunch && !(await deps.canLaunch())) {
          report.skipped = "daily browser time is used up, waiting for 00:00 UTC";
          continue;
        }
        await runRegistration(env, deps, j.id);
        report.ran.push(j.id);
      }
    }
  } finally {
    await dropLock(env.DB, "tick_lock", owner);
  }
  return report;
}
