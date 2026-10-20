// Free plan limits for Browser Run, tracked in D1. Kept apart from browser.ts so ordinary
// page requests never load the Playwright code.
import { getMeta, setMeta } from "./db";

const LAUNCH_GAP_MS = 20000;          // free plan: one new browser every 20 seconds
export const DAILY_BROWSER_MS = 9 * 60 * 1000; // free plan allows 10 minutes a day, keep one spare

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type LimitsFn = () => Promise<{ allowedBrowserAcquisitions: number; timeUntilNextAllowedBrowserAcquisition: number }>;

/** Waits until a new browser is allowed, then records the launch time in D1. */
export class LaunchGate {
  constructor(private db: D1Database, private limits: LimitsFn | null,
    private wait: (ms: number) => Promise<unknown> = sleep, private clock: () => number = Date.now) {}

  async open(): Promise<void> {
    const last = Number(await getMeta(this.db, "browser_last_launch")) || 0;
    const gap = last + LAUNCH_GAP_MS - this.clock();
    if (gap > 0) await this.wait(Math.min(gap, LAUNCH_GAP_MS));
    if (this.limits) {
      try {
        const l = await this.limits();
        if (!l.allowedBrowserAcquisitions && l.timeUntilNextAllowedBrowserAcquisition > 0) {
          await this.wait(Math.min(l.timeUntilNextAllowedBrowserAcquisition, 60000));
        }
      } catch {
        // The limits call is only a hint. The D1 gap above is the real guard.
      }
    }
    await setMeta(this.db, "browser_last_launch", String(this.clock()));
  }
}

export function usageKey(ms = Date.now()): string {
  return "browser_ms:" + new Date(ms).toISOString().slice(0, 10); // the allowance resets at 00:00 UTC
}

export async function browserMsToday(db: D1Database): Promise<number> {
  return Number(await getMeta(db, usageKey())) || 0;
}

export async function addBrowserMs(db: D1Database, ms: number): Promise<void> {
  await db.prepare("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET " +
    "value=CAST(COALESCE(meta.value,0) AS INTEGER)+CAST(excluded.value AS INTEGER)").bind(usageKey(), String(Math.round(ms))).run();
}

