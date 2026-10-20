import { addBrowserMs, browserMsToday, DAILY_BROWSER_MS, LaunchGate } from "./gate";
import { dropLock, getMeta, setMeta, takeLock } from "./db";
import { MockDriver, type Driver } from "./driver";
import type { Env } from "./env";
import { settings } from "./env";
import { sendMail } from "./mail";
import { handleFetch } from "./routes";
import { tick } from "./scheduler";

export type { Env };

/** Runs the property dropdown check once per DRY_RUN_ONCE value. It only loads the start page. */
export async function maybeDryRun(env: Env): Promise<void> {
  const want = env.DRY_RUN_ONCE;
  if (!want || (await getMeta(env.DB, "dry_run_done")) === want) return;
  if (!(await takeLock(env.DB, "dry_run_lock:" + want, want, Date.now() / 1000, 300))) return;
  await setMeta(env.DB, "dry_run_done", want); // mark first, so a crash cannot make it repeat
  try {
    const { dryRun, limitsOf } = await import("./browser"); // Playwright loads only when a browser is needed
    const r = await dryRun(env.BROWSER, new LaunchGate(env.DB, limitsOf(env.BROWSER)), settings(env).property);
    await addBrowserMs(env.DB, r.browserMs);
    const summary = { at: new Date().toISOString(), ok: r.ok, count: r.count, hasProperty: r.hasProperty,
      browserSeconds: Math.round(r.browserMs / 100) / 10, error: r.error ?? null, options: r.options };
    await setMeta(env.DB, "dry_run_result", JSON.stringify(summary));
    console.log("[dry run]", JSON.stringify(summary));
  } finally {
    await dropLock(env.DB, "dry_run_lock:" + want, want);
  }
}

/** The real driver, with the Playwright code loaded on first use so page requests stay light. */
class LazyBrowserDriver implements Driver {
  private inner: Driver | null = null;
  constructor(private env: Env) {}
  async register(input: Parameters<Driver["register"]>[0]) {
    if (!this.inner) {
      const { BrowserDriver, limitsOf } = await import("./browser");
      const e = this.env;
      this.inner = new BrowserDriver(e.BROWSER, new LaunchGate(e.DB, limitsOf(e.BROWSER)), (ms) => addBrowserMs(e.DB, ms));
    }
    return this.inner.register(input);
  }
}

export function makeDriver(env: Env): Driver {
  if (env.DRIVER === "mock") return new MockDriver();
  return new LazyBrowserDriver(env);
}

export async function runCron(env: Env): Promise<void> {
  await maybeDryRun(env);
  const report = await tick(env, {
    driver: makeDriver(env),
    send: (m) => sendMail(env, m),
    canLaunch: async () => env.DRIVER === "mock" || (await browserMsToday(env.DB)) < DAILY_BROWSER_MS,
  });
  if (report.ran.length || report.done.length || report.skipped) console.log("[scheduler]", JSON.stringify(report));
}

export default {
  fetch: (req: Request, env: Env) => handleFetch(req, env),
  async scheduled(_c: ScheduledController, env: Env): Promise<void> {
    try {
      await runCron(env);
    } catch (err) {
      console.log("[scheduler error]", err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    }
  },
} satisfies ExportedHandler<Env>;
