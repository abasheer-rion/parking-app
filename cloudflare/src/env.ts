import type { BrowserWorker } from "@cloudflare/playwright";

export interface Env {
  DB: D1Database;
  BROWSER: BrowserWorker;
  // Plain settings, in wrangler.jsonc "vars".
  MAX_DAYS?: string;
  PROPERTY?: string;
  UNIT?: string;
  FROM_NAME?: string;
  NOTIFY_ALSO?: string;
  /** "1" makes the cron skip registrations. Keep it on until cutover, so the Mac and the Worker never both register. */
  PAUSE_REGISTRATIONS?: string;
  /** "mock" swaps in the fake driver, for local runs. */
  DRIVER?: string;
  /** Any value runs the property dropdown check once on the next cron tick. Change the value to run it again. */
  DRY_RUN_ONCE?: string;
  // Secrets, set by scripts/set-secrets.sh.
  GMAIL_USER?: string;
  GMAIL_APP_PASSWORD?: string;
}

export function settings(env: Env) {
  const n = parseInt(env.MAX_DAYS ?? "14", 10);
  return {
    maxDays: Number.isFinite(n) ? n : 14,
    property: env.PROPERTY || "SAMPLE COURT",
    unit: env.UNIT || "101",
  };
}
