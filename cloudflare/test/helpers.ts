import { env as testEnv } from "cloudflare:test";
import fixture from "./fixture.json";
import type { Env } from "../src/env";
import { handleFetch } from "../src/routes";

export const env = testEnv as unknown as Env;
export const QR_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 0, 255]);

export async function clearDb(): Promise<void> {
  await env.DB.batch(["friends", "profiles", "jobs", "meta"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
}

export async function loadFixture(): Promise<void> {
  await clearDb();
  const st: D1PreparedStatement[] = [];
  for (const f of fixture.friends) st.push(env.DB.prepare("INSERT INTO friends(id,token,name) VALUES(?,?,?)").bind(f.id, f.token, f.name));
  for (const p of fixture.profiles) {
    st.push(env.DB.prepare("INSERT INTO profiles(id,friend_id,name,email,plate,state,make,model,color) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(p.id, p.friend_id, p.name, p.email, p.plate, p.state, p.make, p.model, p.color));
  }
  for (const j of fixture.jobs as Record<string, unknown>[]) {
    const cols = Object.keys(j).filter((k) => k !== "qr");
    const vals: unknown[] = cols.map((k) => j[k]);
    if (j.qr) { cols.push("qr_path", "qr_png"); vals.push("/nonexistent/qr.png", QR_BYTES); }
    st.push(env.DB.prepare(`INSERT INTO jobs(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`).bind(...vals));
  }
  await env.DB.batch(st);
}

export function call(path: string, init?: RequestInit, e: Env = env): Promise<Response> {
  return handleFetch(new Request("https://parking.test" + path, init), e);
}

export function post(path: string, fields: Record<string, string>, e: Env = env): Promise<Response> {
  return call(path, { method: "POST", body: new URLSearchParams(fields), redirect: "manual" }, e);
}

export async function job(id: number) {
  return env.DB.prepare("SELECT * FROM jobs WHERE id=?").bind(id).first<Record<string, unknown>>();
}
