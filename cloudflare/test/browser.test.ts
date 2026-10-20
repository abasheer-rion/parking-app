// The browser steps against a pretend property site. Nothing here reaches the real site.
import { beforeEach, describe, expect, it } from "vitest";
import { BrowserDriver, dryRun, type Launcher } from "../src/browser";
import { LaunchGate } from "../src/gate";
import { clearDb, env } from "./helpers";
import { getMeta } from "../src/db";

type Step = "property" | "products" | "apartment" | "vehicle" | "contact" | "payment" | "review" | "results";
const ORDER: Step[] = ["property", "products", "apartment", "vehicle", "contact", "payment", "review", "results"];
const NEXT: Record<string, Step> = {
  btn_Property_Next: "products", btn_Products_Next: "apartment", btn_Apartment_Next: "vehicle",
  btn_Vehicle_Next: "contact", btn_Contact_Next: "payment", btn_Payment_Next: "review", btn_Review_Submit: "results",
};

interface SiteOpts { existing?: boolean; noReview?: boolean; noQr?: boolean; noCode?: boolean; throwAt?: Step }

function fakeSite(o: SiteOpts = {}) {
  let step: Step = "property";
  const log: string[] = [];
  let closed = 0;
  const results = () => `Results ${o.existing ? "Permit already exists" : ""} ${o.noCode ? "" : "Confirmation Code RMP-123456"} Expires 10/21/2026 11:30:00 PM`;
  const page = {
    goto: async (u: string) => { log.push("goto " + u); },
    selectOption: async (sel: string, v: unknown) => { log.push(`select ${sel} ${JSON.stringify(v)}`); },
    waitForTimeout: async () => undefined,
    waitForLoadState: async () => undefined,
    click: async (sel: string) => {
      log.push("click " + sel);
      if (o.throwAt === step) throw Object.assign(new Error("Timeout 30000ms exceeded."), { name: "TimeoutError" });
      const m = /name='ctl00\$MainContent\$(\w+)'/.exec(sel);
      if (m) {
        if (step === "vehicle" && o.existing) { step = "results"; return; }
        if (step === "payment" && o.noReview) { step = "payment"; return; }
        step = NEXT[m[1]] ?? step;
      }
    },
    fill: async (sel: string, v: string) => { log.push(`fill ${sel} ${v}`); },
    evaluate: async (js: string) => {
      if (js.includes("input[type=submit]")) {
        return ({ payment: ["btn_Payment_Previous=Previous", "btn_Payment_Next=Next"],
          review: ["btn_Review_Previous=Previous", "btn_Review_Submit=Submit"] } as Record<string, string[]>)[step] ?? [];
      }
      if (js.includes("cloneNode")) return step === "review" ? "Review & Confirm Re-enter Plate I confirm" : "Payment $0.00";
      if (js.includes("MainContent_ddl_Property option")) return ["Select a property", "SAMPLE COURT", "OTHER PLACE"];
      throw new Error("unexpected evaluate");
    },
    innerText: async () => (step === "results" ? results() : "page " + step),
    waitForSelector: async () => { if (step !== "results" || o.noQr) throw new Error("Timeout"); },
    locator: (sel: string) => {
      const one = {
        count: async () => (sel === "#MainContent_img_QRC" && step === "results" && !o.noQr ? 1 : 0),
        first: () => one,
        fill: async (v: string) => { log.push(`fill ${sel} ${v}`); },
        check: async () => { log.push(`check ${sel}`); },
        waitFor: async () => { if (sel !== "#MainContent_img_QRC" || step !== "results" || o.noQr) throw new Error("Timeout"); },
        screenshot: async () => new Uint8Array([1, 2, 3]),
      };
      return one;
    },
  };
  const launcher = (async () => ({
    newPage: async () => page,
    close: async () => { closed++; },
  })) as unknown as Launcher;
  return { launcher, log, closed: () => closed, step: () => step };
}

const gate = { open: async () => undefined };
const input = { vehicle: { plate: "ABC1234", state: "TX", make: "Honda", model: "Civic", color: "Blue" },
  email: "g@example.com", property: "SAMPLE COURT", unit: "101" };
const browser = {} as never;

describe("BrowserDriver, same steps as worker.py", () => {
  it("walks every step, retypes the plate and ticks the box on Review, reads code, expiry and QR", async () => {
    const s = fakeSite();
    const r = await new BrowserDriver(browser, gate, undefined, s.launcher).register(input);
    expect(r).toMatchObject({ ok: true, message: "registered", confirmation: "RMP-123456", expires_ts: 1792643400, existing: false });
    expect(r.qr).toEqual(new Uint8Array([1, 2, 3]));
    expect(s.log).toContain(`select #MainContent_ddl_Property {"label":"SAMPLE COURT"}`);
    expect(s.log).toContain("fill input[name='ctl00$MainContent$txt_Apartment'] 101");
    expect(s.log).toContain(`select select[name='ctl00$MainContent$ddl_State'] {"value":"TX"}`);
    expect(s.log).toContain("fill input[type=text]:visible ABC1234");
    expect(s.log).toContain("check input[type=checkbox]:visible");
    expect(s.log.filter((l) => l.startsWith("click")).at(-1)).toBe("click input[name='ctl00$MainContent$btn_Review_Submit']");
    expect(s.closed()).toBe(1);
  });
  it("'Permit already exists' jumps to Results and is read there, without filling the email", async () => {
    const s = fakeSite({ existing: true });
    const r = await new BrowserDriver(browser, gate, undefined, s.launcher).register(input);
    expect(r).toMatchObject({ ok: true, existing: true, confirmation: "RMP-123456" });
    expect(s.log.some((l) => l.includes("txt_Email"))).toBe(false);
    expect(s.closed()).toBe(1);
  });
  it("never submits when the Review step does not show up", async () => {
    const s = fakeSite({ noReview: true });
    const r = await new BrowserDriver(browser, gate, undefined, s.launcher).register(input);
    expect(r).toMatchObject({ ok: false, message: "Error: Never reached the Review step" });
    expect(s.log.some((l) => l.startsWith("check"))).toBe(false);
    expect(s.closed()).toBe(1);
  });
  it("a code without the QR element is not a success", async () => {
    const s = fakeSite({ noQr: true });
    const r = await new BrowserDriver(browser, gate, undefined, s.launcher).register(input);
    expect(r.ok).toBe(false);
    expect(r.message.startsWith("site did not confirm: ")).toBe(true);
  });
  it("a QR without a code is not a success", async () => {
    const s = fakeSite({ noCode: true });
    expect((await new BrowserDriver(browser, gate, undefined, s.launcher).register(input)).ok).toBe(false);
  });
  it("errors become a failed result and the browser is still closed", async () => {
    const s = fakeSite({ throwAt: "apartment" });
    const r = await new BrowserDriver(browser, gate, undefined, s.launcher).register(input);
    expect(r).toMatchObject({ ok: false, message: "TimeoutError: Timeout 30000ms exceeded." });
    expect(s.closed()).toBe(1);
  });
  it("reports browser time", async () => {
    const used: number[] = [];
    const s = fakeSite();
    await new BrowserDriver(browser, gate, async (ms) => { used.push(ms); }, s.launcher).register(input);
    expect(used).toHaveLength(1);
  });
});

describe("dry run", () => {
  it("only loads the page and reads the dropdown", async () => {
    const s = fakeSite();
    const r = await dryRun(browser, gate, "SAMPLE COURT", s.launcher);
    expect(r).toMatchObject({ ok: true, count: 3, hasProperty: true });
    expect(s.log).toEqual(["goto https://registermyplate.com/visitors/"]);
    expect(s.closed()).toBe(1);
  });
});

describe("LaunchGate: one new browser per 20 seconds", () => {
  beforeEach(clearDb);
  it("waits out the rest of the 20 seconds since the last launch", async () => {
    let t = 1_000_000;
    const waits: number[] = [];
    const g = new LaunchGate(env.DB, null, async (ms) => { waits.push(ms); t += ms; }, () => t);
    await g.open();
    expect(waits).toEqual([]);
    t += 5000;
    await g.open();
    expect(waits).toEqual([15000]);
    expect(Number(await getMeta(env.DB, "browser_last_launch"))).toBe(t);
    t += 25000;
    await g.open();
    expect(waits).toEqual([15000]);
  });
});
