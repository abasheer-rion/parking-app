// Drives the registermyplate.com visitor wizard in Cloudflare Browser Run.
// Ported step for step from worker.py: same selectors, same waits, same Review step handling.
import { launch, limits, type Browser, type BrowserWorker, type Page } from "@cloudflare/playwright";
import type { LaunchGate } from "./gate";
import type { Driver, RegisterInput, Result } from "./driver";
import { parseSiteTime } from "./time";

export const URL = "https://registermyplate.com/visitors/";
const M = "ctl00$MainContent$";
const QR_SEL = "#MainContent_img_QRC";
const PROPERTY_SEL = "#MainContent_ddl_Property";

/** Browser Run's own view of the launch limit, for LaunchGate. */
export function limitsOf(binding: BrowserWorker) {
  return () => limits(binding);
}

async function next(pg: Page, name: string) {
  await pg.click(`input[name='${M}${name}']`);
  await pg.waitForLoadState("networkidle");
  await pg.waitForTimeout(1500);
}

async function submits(pg: Page): Promise<string[]> {
  return pg.evaluate("(()=>[...document.querySelectorAll('input[type=submit]')]" +
    ".filter(e=>e.offsetParent).map(e=>e.name.replace('ctl00$MainContent$','')+'='+e.value))()");
}

/** Text of a detached copy of the body. It includes hidden validator text, so it is only used
 * to spot the Review step, never to judge success. */
async function bodyText(pg: Page): Promise<string> {
  return pg.evaluate("(()=>{const c=document.body.cloneNode(true);" +
    "c.querySelectorAll('select,option,script,style').forEach(e=>e.remove());" +
    "return c.innerText.replace(/\\s+/g,' ')})()");
}

/** Reads the Results page. Success needs the QR element and a confirmation code. */
async function collect(pg: Page): Promise<Result> {
  const text = await pg.innerText("body");
  const m = /Confirmation Code\s*([A-Z0-9][A-Z0-9-]{5,})/i.exec(text);
  const code = m ? m[1].trim() : null;
  const e = /Expires\s*(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2}\s*[AP]M)/i.exec(text);
  const expires_ts = e ? parseSiteTime(e[1].toUpperCase().replace(/\s+/g, " ")) : null;
  let qrSeen = false;
  let qr: Uint8Array | null = null;
  try {
    const el = pg.locator(QR_SEL).first();
    await el.waitFor({ state: "visible", timeout: 5000 });
    qrSeen = true;
    qr = new Uint8Array(await el.screenshot());
  } catch {
    qr = null;
  }
  const ok = !!code && qrSeen;
  return {
    ok, message: ok ? "registered" : code ? "no QR code found" : "no confirmation code found",
    expires_ts, confirmation: code, qr, existing: text.toLowerCase().includes("already exists"),
  };
}

function errText(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

export type Launcher = (binding: BrowserWorker) => Promise<Browser>;

export class BrowserDriver implements Driver {
  constructor(private binding: BrowserWorker, private gate: Pick<LaunchGate, "open">,
    private onUsage: (ms: number) => Promise<void> = async () => undefined,
    private launcher: Launcher = (b) => launch(b)) {}

  async register(input: RegisterInput): Promise<Result> {
    const { vehicle: v, email, property, unit } = input;
    await this.gate.open();
    const started = Date.now();
    let browser: Browser | null = null;
    let r: Result;
    try {
      browser = await this.launcher(this.binding);
      const pg = await browser.newPage();
      r = await this.walk(pg, v, email, property, unit);
    } catch (err) {
      r = { ok: false, message: errText(err) };
    } finally {
      if (browser) await browser.close().catch(() => undefined);
    }
    r.browserMs = Date.now() - started;
    await this.onUsage(r.browserMs).catch(() => undefined);
    return r;
  }

  private async walk(pg: Page, v: RegisterInput["vehicle"], email: string, property: string, unit: string): Promise<Result> {
    try {
      await pg.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
      await pg.selectOption(PROPERTY_SEL, { label: property });
      await pg.waitForTimeout(1200);
      await next(pg, "btn_Property_Next");
      await pg.click("text=Guest Parking");
      await pg.waitForTimeout(600);
      await next(pg, "btn_Products_Next");
      await pg.fill(`input[name='${M}txt_Apartment']`, unit);
      await next(pg, "btn_Apartment_Next");
      await pg.fill(`input[name='${M}txt_Plate']`, v.plate);
      await pg.fill(`input[name='${M}txt_Make']`, v.make);
      await pg.fill(`input[name='${M}txt_Model']`, v.model);
      await pg.fill(`input[name='${M}txt_Color']`, v.color);
      await pg.selectOption(`select[name='${M}ddl_State']`, { value: v.state });
      await next(pg, "btn_Vehicle_Next");
      if (await pg.locator(QR_SEL).count()) return await collect(pg); // "Permit already exists" jumps to Results
      await pg.fill(`input[name='${M}txt_Email']`, email);
      await next(pg, "btn_Contact_Next");

      // Payment (free) then Review & Confirm. The review step asks for the plate again and a checkbox.
      let submitted = false;
      for (let i = 0; i < 6; i++) {
        const names = await submits(pg);
        const low = (await bodyText(pg)).toLowerCase();
        const nxt = names.filter((n) => !n.toLowerCase().includes("previous")).map((n) => n.split("=")[0]);
        if (!nxt.length) break;
        if (low.includes("review & confirm") || low.includes("re-enter plate")) {
          await pg.locator("input[type=text]:visible").first().fill(v.plate);
          await pg.locator("input[type=checkbox]:visible").first().check();
          await next(pg, nxt[0]);
          submitted = true;
          break;
        }
        await next(pg, nxt[0]);
      }
      if (!submitted) throw new Error("Never reached the Review step");

      try {
        await pg.waitForSelector(QR_SEL, { timeout: 25000 });
      } catch {
        // collect() reports what is missing
      }
      const r = await collect(pg);
      if (!r.ok) r.message = "site did not confirm: " + (await pg.innerText("body")).slice(-300);
      return r;
    } catch (err) {
      return { ok: false, message: errText(err) };
    }
  }
}

export interface DryRunResult { ok: boolean; count: number; options: string[]; hasProperty: boolean; browserMs: number; error?: string }

/** Loads the start page and reads the property dropdown. Touches no form field and clicks nothing. */
export async function dryRun(binding: BrowserWorker, gate: Pick<LaunchGate, "open">, property: string,
  launcher: Launcher = (b) => launch(b)): Promise<DryRunResult> {
  await gate.open();
  const started = Date.now();
  let browser: Browser | null = null;
  let r: DryRunResult;
  try {
    browser = await launcher(binding);
    const pg = await browser.newPage();
    await pg.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
    const options: string[] = await pg.evaluate(
      `(()=>[...document.querySelectorAll(${JSON.stringify(PROPERTY_SEL + " option")})].map(o=>o.textContent.trim()))()`);
    r = { ok: true, count: options.length, options, hasProperty: options.includes(property), browserMs: 0 };
  } catch (err) {
    r = { ok: false, count: 0, options: [], hasProperty: false, browserMs: 0, error: errText(err) };
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
  r.browserMs = Date.now() - started;
  return r;
}
