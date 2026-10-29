import type { BrowserWorker } from "@cloudflare/playwright";

export interface Env {
  DB: D1Database;
  BROWSER: BrowserWorker;
  // Plain settings, in wrangler.jsonc "vars".
  MAX_DAYS?: string;
  /** Property and unit for pages made before public sign-up. Worker secrets, not vars. */
  PROPERTY?: string;
  UNIT?: string;
  /** Most new pages the public sign-up makes per day. Default 30. */
  MAX_NEW_PAGES?: string;
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
    // Fallback for pages made before public sign-up. Set as Worker secrets, never in the repo.
    property: env.PROPERTY || "",
    unit: env.UNIT || "",
  };
}

/** The property and unit a page registers at: its own, else the Worker settings. */
export function placeOf(env: Env, f: { property?: string | null; unit?: string | null }) {
  const s = settings(env);
  return { property: f.property || s.property, unit: f.unit || s.unit };
}
