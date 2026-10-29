import { beforeEach, describe, expect, it } from "vitest";
import { call, env, loadFixture, post } from "./helpers";

const ok = { name: "Sam", property: "sample court", unit: "12B", ok: "1" };

describe("public sign-up", () => {
  beforeEach(loadFixture);

  it("home page shows the sign-up form and loads the device script", async () => {
    const r = await call("/");
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('action="/start"');
    expect(html).toContain('<script src="/app.js" defer></script>');
  });

  it("app.js remembers the page and sends a returning device straight to it", async () => {
    const r = await call("/app.js");
    expect(r.headers.get("Content-Type")).toContain("javascript");
    const js = await r.text();
    expect(js).toContain("localStorage");
    expect(js).toContain('location.replace("/u/" + saved)');
  });

  it("makes a page with its own property and unit, then shows them", async () => {
    const r = await post("/start", ok);
    expect(r.status).toBe(302);
    const loc = r.headers.get("Location")!;
    expect(loc).toMatch(/^\/u\/[A-Za-z0-9_-]{24}$/);
    const row = await env.DB.prepare("SELECT name, property, unit FROM friends WHERE token=?")
      .bind(decodeURIComponent(loc.slice(3))).first();
    expect(row).toEqual({ name: "Sam", property: "SAMPLE COURT", unit: "12B" });
    expect(await (await call(loc)).text()).toContain("saving you a spot at Sample Court, unit 12B");
  });

  it("refuses missing fields and an unticked box", async () => {
    expect((await post("/start", { ...ok, unit: "" })).status).toBe(400);
    expect((await post("/start", { ...ok, ok: "" })).status).toBe(400);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM friends WHERE name='Sam'").first<{ n: number }>())!.n).toBe(0);
  });

  it("only accepts a property from the last dropdown check when one exists", async () => {
    await env.DB.prepare("INSERT INTO meta(key,value) VALUES('dry_run_result', ?)")
      .bind(JSON.stringify({ options: ["Select a property", "SAMPLE COURT"] })).run();
    expect((await post("/start", { ...ok, property: "Nowhere Flats" })).status).toBe(400);
    expect((await post("/start", ok)).status).toBe(302);
  });

  it("stops at the daily cap", async () => {
    const key = "new_pages:" + new Date().toISOString().slice(0, 10);
    await env.DB.prepare("INSERT INTO meta(key,value) VALUES(?, '30')").bind(key).run();
    expect((await post("/start", ok)).status).toBe(429);
    expect(await (await call("/")).text()).toContain("New pages are full for today");
  });

  it("wrong methods are 405", async () => {
    expect((await call("/start")).status).toBe(405);
    expect((await post("/", ok)).status).toBe(405);
  });
});
