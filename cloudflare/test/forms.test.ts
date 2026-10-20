import { beforeEach, describe, expect, it } from "vitest";
import { call, env, loadFixture, post } from "./helpers";

beforeEach(loadFixture);
const T1 = "/u/tok-alpha-123";
const car = { email: " new@example.com ", plate: " abc1234 ", state: "CA", make: " Honda ", model: "Fit ", color: " Red", days: "3" };

async function rows(sql: string, ...b: unknown[]) {
  return (await env.DB.prepare(sql).bind(...b).all<Record<string, unknown>>()).results;
}

describe("New ride form", () => {
  it("queues a pending job, stops the old one for that plate, redirects home", async () => {
    const before = Date.now() / 1000;
    const r = await post(`${T1}/register`, car);
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe(T1);
    const [j] = await rows("SELECT * FROM jobs ORDER BY id DESC LIMIT 1");
    expect(j).toMatchObject({ plate: "ABC1234", state: "CA", make: "Honda", model: "Fit", color: "Red",
      email: "new@example.com", status: "pending", who: "Pat O'Neil & <Co>", fails: 0 });
    expect(Math.round((j.end_ts as number) - (j.start_ts as number))).toBe(3 * 86400);
    expect(j.start_ts as number).toBeGreaterThanOrEqual(before - 1);
    expect((await rows("SELECT status FROM jobs WHERE id=2"))[0].status).toBe("stopped");
    // the page now shows "working on it" and refreshes itself
    const html = await (await call(T1)).text();
    expect(html).toContain('<meta http-equiv="refresh" content="6">');
    expect(html).toContain("Saving your spot now, this page updates on its own.");
  });
  it("clamps days to 1..MAX_DAYS", async () => {
    await post(`${T1}/register`, { ...car, days: "99" });
    await post(`${T1}/register`, { ...car, plate: "Q1", days: "-4" });
    const js = await rows("SELECT end_ts-start_ts AS d FROM jobs ORDER BY id DESC LIMIT 2");
    expect(js.map((x) => Math.round(x.d as number))).toEqual([86400, 14 * 86400]);
  });
  it("days must be a number", async () => {
    const r = await post(`${T1}/register`, { ...car, days: "two" });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("Days must be a number.");
  });
  it("a missing field is a 400, like Flask", async () => {
    const { plate: _p, ...noPlate } = car;
    expect((await post(`${T1}/register`, noPlate)).status).toBe(400);
  });
  it("unknown token is 404 and writes nothing", async () => {
    expect((await post("/u/nope/register", car)).status).toBe(404);
    expect(await rows("SELECT id FROM jobs")).toHaveLength(5);
  });
});

describe("profiles", () => {
  it("add cleans the plate and defaults the state to TX", async () => {
    await post(`${T1}/profile/new`, { name: " Kim ", email: "k@example.com", plate: " ab 12 c ", state: "", make: "M", model: "N", color: "C" });
    const [p] = await rows("SELECT * FROM profiles ORDER BY id DESC LIMIT 1");
    expect(p).toMatchObject({ name: "Kim", plate: "AB12C", state: "TX", friend_id: 1 });
  });
  it("add and save need a name", async () => {
    expect(await (await post(`${T1}/profile/new`, { name: " " })).text()).toContain("Add a name.");
    expect(await (await post(`${T1}/profile/1/save`, { name: "" })).text()).toContain("A profile needs a name.");
  });
  it("save and delete only touch this friend's profiles", async () => {
    await post("/u/tok-empty-456/profile/1/save", { name: "Hacker" });
    await post("/u/tok-empty-456/profile/1/delete", {});
    expect((await rows("SELECT name FROM profiles WHERE id=1"))[0].name).toBe("Pat");
    await post(`${T1}/profile/1/save`, { name: "Pat2", plate: "zz 9" });
    expect((await rows("SELECT name,plate,state FROM profiles WHERE id=1"))[0]).toEqual({ name: "Pat2", plate: "ZZ9", state: "TX" });
    await post(`${T1}/profile/1/delete`, {});
    expect(await rows("SELECT id FROM profiles WHERE id=1")).toHaveLength(0);
  });
  it("go needs a full profile", async () => {
    const r = await post(`${T1}/profile/2/go`, { days: "1" });
    expect(await r.text()).toContain("Sam &#34;Quotes&#34; needs a plate, make, model, color and email first. Use Edit.");
  });
  it("go queues a job under the profile's name", async () => {
    const r = await post(`${T1}/profile/3/go`, { days: "2" });
    expect(r.status).toBe(302);
    const [j] = await rows("SELECT * FROM jobs ORDER BY id DESC LIMIT 1");
    expect(j).toMatchObject({ plate: "XYZ9", state: "CA", who: "Lee", email: "lee@example.com", status: "pending" });
    expect((await rows("SELECT status FROM jobs WHERE id=3"))[0].status).toBe("stopped");
  });
  it("go on someone else's profile is 404", async () => {
    expect((await post("/u/tok-empty-456/profile/3/go", { days: "1" })).status).toBe(404);
  });
});

describe("jobs", () => {
  it("Done staying stops the job", async () => {
    expect((await post(`${T1}/stop/2`, {})).status).toBe(302);
    expect((await rows("SELECT status FROM jobs WHERE id=2"))[0].status).toBe("stopped");
  });
  it("again re-queues a past job with the friend's name", async () => {
    await post(`${T1}/again/1`, { days: "1" });
    const [j] = await rows("SELECT * FROM jobs ORDER BY id DESC LIMIT 1");
    expect(j).toMatchObject({ plate: "OLD111", who: "Pat O'Neil & <Co>", status: "pending" });
    expect((await post("/u/tok-empty-456/again/1", { days: "1" })).status).toBe(404);
  });
});
