import { beforeEach, describe, expect, it } from "vitest";
import { createScheduledController } from "cloudflare:test";
import { MockDriver, type Result } from "../src/driver";
import type { Mail } from "../src/emails";
import type { Env } from "../src/env";
import { tick } from "../src/scheduler";
import { takeLock } from "../src/db";
import worker from "../src/index";
import { clearDb, env, job } from "./helpers";
import { parseSiteTime } from "../src/time";

const T = 1792557000; // Tue Oct 20 2026, 11:30 PM in Chicago
let sent: Mail[];
beforeEach(async () => {
  await clearDb();
  sent = [];
  await env.DB.prepare("INSERT INTO friends(id,token,name) VALUES(1,'tok','Friend')").run();
});

async function addJob(fields: Record<string, unknown>): Promise<number> {
  const row = { friend_id: 1, plate: "ABC123", state: "TX", make: "Honda", model: "Civic", color: "Blue",
    email: "g@example.com", start_ts: T - 3600, end_ts: T + 3 * 86400, status: "pending", fails: 0, who: "Pat", ...fields };
  const cols = Object.keys(row);
  const r = await env.DB.prepare(`INSERT INTO jobs(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`)
    .bind(...Object.values(row)).run();
  return r.meta.last_row_id as number;
}

const ok = (over: Partial<Result> = {}): Result => ({
  ok: true, message: "registered", expires_ts: T + 86400, confirmation: "CODE-123456", qr: new Uint8Array([9, 9]), ...over,
});

function run(driver: MockDriver, now = T, e: Env = env, canLaunch?: () => Promise<boolean>) {
  return tick(e, { driver, send: async (m) => { sent.push(m); return true; }, now: () => now, canLaunch });
}

describe("scheduler rules, same as app.py", () => {
  it("registers a new pending job, stores code and QR, emails 'confirmed'", async () => {
    const id = await addJob({});
    const d = new MockDriver(() => ok());
    const rep = await run(d);
    expect(rep.ran).toEqual([id]);
    expect(d.calls[0]).toMatchObject({ vehicle: { plate: "ABC123", state: "TX" }, email: "g@example.com",
      property: "SAMPLE COURT", unit: "101" });
    const j = await job(id);
    expect(j).toMatchObject({ status: "active", fails: 0, error: null, next_try: null, last_ok_ts: T,
      expires_ts: T + 86400, confirmation: "CODE-123456" });
    expect(new Uint8Array(j!.qr_png as ArrayBuffer)).toEqual(new Uint8Array([9, 9]));
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("Parking confirmed for ABC123, code CODE-123456");
    expect(sent[0].image).toEqual(new Uint8Array([9, 9]));
  });
  it("without an expiry from the site, assumes 24 hours", async () => {
    const id = await addJob({});
    await run(new MockDriver(() => ok({ expires_ts: null })));
    expect((await job(id))!.expires_ts).toBe(T + 86400);
  });
  it("does nothing while a permit is still live", async () => {
    await addJob({ status: "active", expires_ts: T + 60, last_ok_ts: T - 86400 });
    const d = new MockDriver(() => ok());
    expect((await run(d)).ran).toEqual([]);
    expect(d.calls).toHaveLength(0);
  });
  it("renews right after expiry when more days remain, emails 'renewed'", async () => {
    const id = await addJob({ status: "active", expires_ts: T, last_ok_ts: T - 86400, confirmation: "OLD" });
    await run(new MockDriver(() => ok()));
    expect((await job(id))!.confirmation).toBe("CODE-123456");
    expect(sent[0].subject).toBe("Parking renewed for ABC123, new code CODE-123456");
  });
  it("marks done when the last permit ran out and 30 minutes or less of the stay remain", async () => {
    const id = await addJob({ status: "active", expires_ts: T, last_ok_ts: T - 86400, end_ts: T + 1800 });
    const d = new MockDriver(() => ok());
    const rep = await run(d);
    expect(rep.done).toEqual([id]);
    expect(d.calls).toHaveLength(0);
    expect((await job(id))!.status).toBe("done");
  });
  it("more than 30 minutes left means one more renewal", async () => {
    const id = await addJob({ status: "active", expires_ts: T, last_ok_ts: T - 86400, end_ts: T + 1801 });
    expect((await run(new MockDriver(() => ok()))).ran).toEqual([id]);
  });
  it("a failure retries in 10 minutes, emails on the 1st and the 5th, then stops", async () => {
    const id = await addJob({});
    const d = new MockDriver(() => ({ ok: false, message: "TimeoutError: slow" }));
    let t = T;
    for (let i = 1; i <= 5; i++) {
      await run(d, t);
      const j = await job(id);
      expect(j!.fails).toBe(i);
      expect(j!.next_try).toBe(t + 600);
      expect(j!.status).toBe(i < 5 ? "pending" : "failed");
      // too early: nothing happens
      await run(d, t + 599);
      expect((await job(id))!.fails).toBe(i);
      t += 600;
    }
    expect(d.calls).toHaveLength(5);
    expect(sent.map((m) => m.subject)).toEqual(["Could not register parking for ABC123", "Could not register parking for ABC123"]);
    expect(sent[0].body).toContain("It will try again in about 10 minutes");
    expect(sent[1].body).toContain("It has stopped trying.");
    await run(d, t + 6000);
    expect(d.calls).toHaveLength(5);
  });
  it("a failed renewal keeps the job active and says 'renew'", async () => {
    const id = await addJob({ status: "active", expires_ts: T, last_ok_ts: T - 86400 });
    await run(new MockDriver(() => ({ ok: false, message: "boom" })));
    expect((await job(id))!.status).toBe("active");
    expect(sent[0].subject).toBe("Could not renew parking for ABC123");
  });
  it("success resets the fail count", async () => {
    const id = await addJob({ fails: 3, next_try: T - 1, error: "x" });
    await run(new MockDriver(() => ok()));
    expect(await job(id)).toMatchObject({ fails: 0, error: null, next_try: null, status: "active" });
  });
  it("'Done staying' pressed during a run is not undone", async () => {
    const id = await addJob({});
    await run(new MockDriver(async () => {
      await env.DB.prepare("UPDATE jobs SET status='stopped' WHERE id=?").bind(id).run();
      return ok();
    }));
    expect((await job(id))!.status).toBe("stopped");
  });
  it("stopped, done and failed jobs are left alone", async () => {
    for (const status of ["stopped", "done", "failed"]) await addJob({ status });
    const d = new MockDriver(() => ok());
    await run(d);
    expect(d.calls).toHaveLength(0);
  });
  it("runs several due jobs one after another", async () => {
    const a = await addJob({}), b = await addJob({ plate: "XYZ9" });
    let busy = 0, maxBusy = 0;
    const d = new MockDriver(async () => { busy++; maxBusy = Math.max(maxBusy, busy); await Promise.resolve(); busy--; return ok(); });
    expect((await run(d)).ran).toEqual([a, b]);
    expect(maxBusy).toBe(1);
  });
  it("a second tick while one is running does nothing", async () => {
    await addJob({});
    expect(await takeLock(env.DB, "tick_lock", "other", T, 840)).toBe(true);
    const d = new MockDriver(() => ok());
    expect((await run(d)).skipped).toBe("another run is still working");
    expect(d.calls).toHaveLength(0);
    // the lock expires on its own if a run died
    expect((await run(d, T + 841)).ran).toHaveLength(1);
  });
  it("PAUSE_REGISTRATIONS=1 skips the browser but still marks finished jobs done", async () => {
    const due = await addJob({});
    const old = await addJob({ status: "active", expires_ts: T, last_ok_ts: T - 86400, end_ts: T });
    const d = new MockDriver(() => ok());
    const rep = await run(d, T, { ...env, PAUSE_REGISTRATIONS: "1" } as Env);
    expect(d.calls).toHaveLength(0);
    expect(rep.done).toEqual([old]);
    expect((await job(due))!.status).toBe("pending");
  });
  it("waits when the daily browser time is used up, without counting a failure", async () => {
    const id = await addJob({});
    const d = new MockDriver(() => ok());
    const rep = await run(d, T, env, async () => false);
    expect(rep.skipped).toContain("daily browser time");
    expect(await job(id)).toMatchObject({ fails: 0, status: "pending" });
  });
});

describe("cron entry point", () => {
  it("scheduled() runs a tick with the mock driver and never throws", async () => {
    const id = await addJob({ start_ts: Date.now() / 1000, end_ts: Date.now() / 1000 + 86400 * 2 });
    await worker.scheduled(createScheduledController({ cron: "* * * * *" }), env);
    expect((await job(id))!.confirmation).toBe("MOCK-1234");
  });
});

describe("daylight saving and the renewal window, same as app.py on the Mac", () => {
  // The driver answers with the expiry text the Results page shows, read like worker.py reads it.
  const site = (...expiries: string[]) => {
    let i = 0;
    return new MockDriver(() => ok({ expires_ts: parseSiteTime(expiries[i++]) }));
  };

  it("a stay across the November change: 24 h days, renew only after expiry, then done", async () => {
    const start = 1793466000; // Sat Oct 31 2026, 12:00 PM CDT
    const id = await addJob({ start_ts: start, end_ts: start + 2 * 86400 }); // 2 days, as start_job() makes it
    const d = site("11/01/2026 12:00:00 PM", "11/02/2026 12:00:00 PM");
    await run(d, start);
    const e1 = 1793556000; // Sun Nov 01, 12:00 PM CST, 25 hours after the start
    expect((await job(id))!.expires_ts).toBe(e1);
    expect(sent[0].body).toContain("Covered until: Sun Nov 01, 12:00 PM\nStay ends: Mon Nov 02, 11:00 AM\n");
    expect(sent[0].body).toContain("The app will try to renew right after this permit ends");
    // no early renewal: app.py's unused RENEW_WITHIN (2 hours) never applied
    for (const t of [e1 - 7200, e1 - 1]) expect((await run(d, t)).ran).toEqual([]);
    expect(d.calls).toHaveLength(1);
    expect((await run(d, e1)).ran).toEqual([id]);
    const e2 = 1793642400; // Mon Nov 02, 12:00 PM, past the 11:00 AM stay end
    expect((await job(id))!.expires_ts).toBe(e2);
    expect(sent[1].subject).toBe("Parking renewed for ABC123, new code CODE-123456");
    expect(sent[1].body).toContain("This covers the last day of the stay, so no renewal is planned.");
    expect((await run(d, e2 - 1)).done).toEqual([]);
    expect((await run(d, e2)).done).toEqual([id]);
    expect(d.calls).toHaveLength(2);
    expect((await job(id))!.status).toBe("done");
  });

  it("a stay across the March change gets one more renewal for the extra hour", async () => {
    const start = 1804960800; // Sat Mar 13 2027, 12:00 PM CST
    const id = await addJob({ start_ts: start, end_ts: start + 2 * 86400 }); // ends Mon Mar 15, 1:00 PM CDT
    const d = site("03/14/2027 12:00:00 PM", "03/15/2027 12:00:00 PM", "03/16/2027 12:00:00 PM");
    await run(d, start);
    expect((await job(id))!.expires_ts).toBe(1805043600);
    await run(d, 1805043600);
    expect((await job(id))!.expires_ts).toBe(1805130000); // 1 hour before the stay ends: more than 30 minutes
    expect(sent[1].body).toContain("Stay ends: Mon Mar 15, 01:00 PM");
    expect((await run(d, 1805130000)).ran).toEqual([id]);
    expect(d.calls).toHaveLength(3);
    const e3 = (await job(id))!.expires_ts as number;
    expect((await run(d, e3)).done).toEqual([id]);
  });
});
