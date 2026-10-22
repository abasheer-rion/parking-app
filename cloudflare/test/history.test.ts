import { beforeEach, describe, expect, it } from "vitest";
import { call, clearDb, env } from "./helpers";
import { fmt } from "../src/time";

const T0 = 1792505100;

async function seed(): Promise<void> {
  await clearDb();
  const st: D1PreparedStatement[] = [
    env.DB.prepare("INSERT INTO friends(id,token,name) VALUES(1,'tok-a','A'),(2,'tok-b','B')"),
  ];
  const ins = (id: number, friend: number, plate: string, status: string, conf: string | null = null) =>
    env.DB.prepare("INSERT INTO jobs(id,friend_id,plate,state,make,model,color,email,start_ts,end_ts,status,confirmation) " +
      "VALUES(?,?,?,'TX','Kia','Rio','Red','a@x.test',?,?,?,?)")
      .bind(id, friend, plate, T0 + id * 86400, T0 + id * 86400 + 2 * 86400, status, conf);
  // Friend A: 22 finished stays (ids 1..22), plus live ones that belong in current activity.
  for (let i = 1; i <= 22; i++) st.push(ins(i, 1, `A${i}`, i % 2 ? "done" : "stopped", `C-${i}`));
  st.push(ins(23, 1, "LIVE1", "active", "C-LIVE"));
  st.push(ins(24, 1, "PEND1", "pending"));
  st.push(ins(25, 1, "FAIL1", "failed"));
  // The newest finished stay for A has values that must be escaped, and no confirmation code.
  st.push(ins(26, 1, `<b>"X&Y'</b>`, "done", null));
  st.push(ins(27, 1, "ESC2", "stopped", `<script>alert(1)</script>`));
  // Friend B: finished stays that must never show on A's page.
  st.push(ins(30, 2, "BONLY1", "done", "C-B1"));
  st.push(ins(31, 2, "BONLY2", "stopped", "C-B2"));
  await env.DB.batch(st);
}

function section(html: string): string {
  const a = html.indexOf("♥ Past stays");
  const b = html.indexOf("♥ New ride");
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return html.slice(a, b);
}

const plates = (s: string) => [...s.matchAll(/<span class="name">([^<]*)<\/span>/g)].map((m) => m[1]);

beforeEach(seed);

describe("past stays on the friend page", () => {
  it("lists only this friend's finished stays, newest first, at most 20, escaped", async () => {
    const r = await call("/u/tok-a");
    expect(r.status).toBe(200);
    const html = await r.text();
    const s = section(html);
    const got = plates(s);
    const want = ["ESC2", "&lt;b&gt;&#34;X&amp;Y&#39;&lt;/b&gt;", ...Array.from({ length: 18 }, (_, k) => `A${22 - k}`)];
    expect(got).toEqual(want);
    expect(got).toHaveLength(20);
    for (const p of ["A1", "A2", "LIVE1", "PEND1", "FAIL1", "BONLY1", "BONLY2"]) expect(got).not.toContain(p);
    expect(s).not.toContain("C-B1");
    expect(s).not.toContain("<script>");
    expect(s).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(s).toContain("C-22");
    expect(s).toContain(`${fmt(T0 + 22 * 86400)} to ${fmt(T0 + 24 * 86400)}`);
    // Past stays sit below current activity.
    expect(html.indexOf("LIVE1")).toBeLessThan(html.indexOf("♥ Past stays"));
  });

  it("the other friend sees only their own", async () => {
    const got = plates(section(await (await call("/u/tok-b")).text()));
    expect(got).toEqual(["BONLY2", "BONLY1"]);
  });

  it("says so when there are none", async () => {
    await env.DB.prepare("INSERT INTO friends(id,token,name) VALUES(3,'tok-c','C')").run();
    const s = section(await (await call("/u/tok-c")).text());
    expect(s).toContain("No past stays yet.");
    expect(plates(s)).toEqual([]);
  });

  it("keeps the page's security headers", async () => {
    const r = await call("/u/tok-a");
    expect(r.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  });
});
