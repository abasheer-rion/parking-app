// Every route of the Flask app, same paths, same HTML, same redirects and headers.
import { friendByToken, JOB_COLS, type Friend, type Job, type Profile } from "./db";
import type { Env } from "./env";
import { settings } from "./env";
import { BAD_REQUEST, NOT_ALLOWED, NOT_FOUND, pyTitle, redirectBody, renderPage, type PastStay } from "./page";
import { now } from "./time";

const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com; img-src 'self' data:; frame-ancestors 'none'; " +
  "form-action 'self'; base-uri 'none'";
const HTML = "text/html; charset=utf-8";

/** Private tool: keep it out of search engines and other sites' frames. */
function harden(res: Response, path: string): Response {
  const h = res.headers;
  h.set("X-Robots-Tag", "noindex, nofollow");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("X-Frame-Options", "DENY");
  h.set("Referrer-Policy", "no-referrer");
  h.set("Content-Security-Policy", CSP);
  if (path.startsWith("/u/")) h.set("Cache-Control", "no-store");
  return res;
}

class HttpError extends Error {
  constructor(public status: number) { super(String(status)); }
}

const html = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": HTML } });

function errorResponse(status: number, allow?: string): Response {
  const body = status === 404 ? NOT_FOUND : status === 405 ? NOT_ALLOWED : BAD_REQUEST;
  const r = html(body, status);
  if (allow) r.headers.set("Allow", allow);
  return r;
}

function redirectHome(token: string): Response {
  const loc = `/u/${encodeURIComponent(token)}`;
  return new Response(redirectBody(loc), { status: 302, headers: { "Content-Type": HTML, Location: loc } });
}

type Form = { get(k: string): string | null };

async function readForm(req: Request): Promise<Form> {
  const type = req.headers.get("Content-Type") || "";
  if (!/^(application\/x-www-form-urlencoded|multipart\/form-data)/i.test(type)) return { get: () => null };
  try {
    const fd = await req.formData();
    return { get: (k) => { const v = fd.get(k); return typeof v === "string" ? v : null; } };
  } catch {
    throw new HttpError(400);
  }
}

/** Python int() on a form value: optional sign, digits, surrounding spaces. */
function pyInt(s: string): number | null {
  if (!/^\s*[+-]?\d+(?:_\d+)*\s*$/.test(s)) return null;
  return parseInt(s.replace(/_/g, ""), 10);
}

function required(form: Form | Record<string, unknown>, k: string): string {
  const v = typeof (form as Form).get === "function" ? (form as Form).get(k) : (form as Record<string, unknown>)[k];
  if (v === null || v === undefined) throw new HttpError(400); // Flask: missing form key is a 400
  return String(v);
}

async function friendOr404(env: Env, token: string): Promise<Friend> {
  const f = await friendByToken(env.DB, token);
  if (!f) throw new HttpError(404);
  return f;
}

async function page(env: Env, f: Friend, notice: string | null = null, error: string | null = null): Promise<Response> {
  const [active, recent, profiles, past] = await env.DB.batch([
    env.DB.prepare(`SELECT ${JOB_COLS} FROM jobs WHERE friend_id=? AND status IN ('pending','active','failed') ORDER BY id DESC`).bind(f.id),
    env.DB.prepare("SELECT email FROM jobs WHERE id IN (SELECT MAX(id) FROM jobs WHERE friend_id=? GROUP BY plate) " +
      "ORDER BY id DESC LIMIT 1").bind(f.id),
    env.DB.prepare("SELECT * FROM profiles WHERE friend_id=? ORDER BY id").bind(f.id),
    // Finished stays. Failed ones still show above until "Done staying", so they wait until then.
    env.DB.prepare("SELECT id,plate,start_ts,end_ts,confirmation FROM jobs WHERE friend_id=? " +
      "AND status NOT IN ('pending','active','failed') ORDER BY id DESC LIMIT 20").bind(f.id),
  ]);
  const s = settings(env);
  const last = (recent.results[0] as { email: string | null } | undefined)?.email;
  return html(renderPage({
    friend: f, profiles: profiles.results as unknown as Profile[], active: active.results as unknown as (Job & { has_qr: number })[],
    past: past.results as unknown as PastStay[],
    lastEmail: recent.results.length ? (last ?? "None") : "", notice, error,
    maxDays: s.maxDays, unit: s.unit, prop: pyTitle(s.property),
  }));
}

/** Queues a registration. The next cron tick (within a minute) picks it up. Same as start_job(). */
async function startJob(env: Env, f: Friend, data: Form | Record<string, unknown>, days: number): Promise<void> {
  const { maxDays } = settings(env);
  days = Math.max(1, Math.min(maxDays, days));
  const t = now();
  const end = t + days * 86400;
  const plate = required(data, "plate").trim().toUpperCase();
  const state = required(data, "state");
  const make = required(data, "make").trim(), model = required(data, "model").trim();
  const color = required(data, "color").trim(), email = required(data, "email").trim();
  const name = typeof (data as Form).get === "function" ? (data as Form).get("name") : (data as Record<string, unknown>).name as string | null;
  await env.DB.batch([
    env.DB.prepare("UPDATE jobs SET status='stopped' WHERE friend_id=? AND plate=? AND status IN ('pending','active')")
      .bind(f.id, plate),
    env.DB.prepare("INSERT INTO jobs(friend_id,plate,state,make,model,color,email,start_ts,end_ts,status,who) " +
      "VALUES(?,?,?,?,?,?,?,?,?,'pending',?)").bind(f.id, plate, state, make, model, color, email, t, end, name || f.name),
  ]);
}

const FIELDS = ["name", "email", "plate", "state", "make", "model", "color"] as const;

function clean(form: Form): Record<(typeof FIELDS)[number], string> {
  const d = Object.fromEntries(FIELDS.map((k) => [k, (form.get(k) ?? "").trim()])) as Record<(typeof FIELDS)[number], string>;
  d.plate = d.plate.toUpperCase().replace(/ /g, "");
  d.state = d.state || "TX";
  return d;
}

function daysOf(form: Form): number | null {
  return pyInt(form.get("days") ?? "1");
}

type Handler = (env: Env, req: Request, token: string, id: number) => Promise<Response>;
interface Route { re: RegExp; method: "GET" | "POST"; run: Handler }

const ROUTES: Route[] = [
  { re: /^\/u\/([^/]+)$/, method: "GET", run: async (env, _r, token) => page(env, await friendOr404(env, token)) },
  {
    re: /^\/u\/([^/]+)\/register$/, method: "POST", run: async (env, req, token) => {
      const f = await friendOr404(env, token);
      const form = await readForm(req);
      const days = daysOf(form);
      if (days === null) return page(env, f, null, "Days must be a number.");
      await startJob(env, f, form, days);
      return redirectHome(token);
    },
  },
  {
    re: /^\/u\/([^/]+)\/again\/(\d+)$/, method: "POST", run: async (env, req, token, id) => {
      const f = await friendOr404(env, token);
      const j = await env.DB.prepare("SELECT * FROM jobs WHERE id=? AND friend_id=?").bind(id, f.id).first<Job>();
      if (!j) throw new HttpError(404);
      const days = daysOf(await readForm(req));
      if (days === null) return page(env, f, null, "Days must be a number.");
      await startJob(env, f, { ...j, name: null } as unknown as Record<string, unknown>, days);
      return redirectHome(token);
    },
  },
  {
    re: /^\/u\/([^/]+)\/profile\/new$/, method: "POST", run: async (env, req, token) => {
      const f = await friendOr404(env, token);
      const d = clean(await readForm(req));
      if (!d.name) return page(env, f, null, "Add a name.");
      await env.DB.prepare("INSERT INTO profiles(friend_id,name,email,plate,state,make,model,color) VALUES(?,?,?,?,?,?,?,?)")
        .bind(f.id, ...FIELDS.map((k) => d[k])).run();
      return redirectHome(token);
    },
  },
  {
    re: /^\/u\/([^/]+)\/profile\/(\d+)\/save$/, method: "POST", run: async (env, req, token, pid) => {
      const f = await friendOr404(env, token);
      const d = clean(await readForm(req));
      if (!d.name) return page(env, f, null, "A profile needs a name.");
      await env.DB.prepare("UPDATE profiles SET name=?,email=?,plate=?,state=?,make=?,model=?,color=? WHERE id=? AND friend_id=?")
        .bind(...FIELDS.map((k) => d[k]), pid, f.id).run();
      return redirectHome(token);
    },
  },
  {
    re: /^\/u\/([^/]+)\/profile\/(\d+)\/delete$/, method: "POST", run: async (env, _r, token, pid) => {
      const f = await friendOr404(env, token);
      await env.DB.prepare("DELETE FROM profiles WHERE id=? AND friend_id=?").bind(pid, f.id).run();
      return redirectHome(token);
    },
  },
  {
    re: /^\/u\/([^/]+)\/profile\/(\d+)\/go$/, method: "POST", run: async (env, req, token, pid) => {
      const f = await friendOr404(env, token);
      const p = await env.DB.prepare("SELECT * FROM profiles WHERE id=? AND friend_id=?").bind(pid, f.id).first<Profile>();
      if (!p) throw new HttpError(404);
      if (!(p.plate && p.make && p.model && p.color && p.email)) {
        return page(env, f, null, `${p.name} needs a plate, make, model, color and email first. Use Edit.`);
      }
      const days = daysOf(await readForm(req));
      if (days === null) return page(env, f, null, "Days must be a number.");
      await startJob(env, f, p as unknown as Record<string, unknown>, days);
      return redirectHome(token);
    },
  },
  {
    re: /^\/u\/([^/]+)\/qr\/(\d+)$/, method: "GET", run: async (env, _r, token, id) => {
      const f = await friendOr404(env, token);
      const j = await env.DB.prepare("SELECT qr_png FROM jobs WHERE id=? AND friend_id=?").bind(id, f.id)
        .first<{ qr_png: ArrayBuffer | number[] | null }>();
      if (!j || !j.qr_png) throw new HttpError(404);
      const bytes = j.qr_png instanceof ArrayBuffer ? new Uint8Array(j.qr_png) : new Uint8Array(j.qr_png);
      if (!bytes.length) throw new HttpError(404);
      return new Response(bytes, { headers: { "Content-Type": "image/png" } });
    },
  },
  {
    re: /^\/u\/([^/]+)\/stop\/(\d+)$/, method: "POST", run: async (env, _r, token, id) => {
      const f = await friendOr404(env, token);
      await env.DB.prepare("UPDATE jobs SET status='stopped' WHERE id=? AND friend_id=?").bind(id, f.id).run();
      return redirectHome(token);
    },
  },
];

function decode(seg: string): string | null {
  try { return decodeURIComponent(seg); } catch { return null; }
}

export async function handleFetch(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  let res: Response;
  try {
    res = await route(req, env, path);
  } catch (err) {
    if (err instanceof HttpError) res = errorResponse(err.status);
    else {
      console.log("[error]", err instanceof Error ? `${err.name}: ${err.message}` : String(err));
      res = html(`<!doctype html>
<html lang=en>
<title>500 Internal Server Error</title>
<h1>Internal Server Error</h1>
<p>The server encountered an internal error and was unable to complete your request. Either the server is overloaded or there is an error in the application.</p>
`, 500);
    }
  }
  if (req.method === "HEAD") res = new Response(null, res);
  return harden(res, path);
}

async function route(req: Request, env: Env, path: string): Promise<Response> {
  const method = req.method === "HEAD" ? "GET" : req.method;
  if (path === "/robots.txt") {
    if (method === "OPTIONS") return new Response("", { headers: { Allow: "GET, HEAD, OPTIONS" } });
    if (method !== "GET") return errorResponse(405, "GET, HEAD, OPTIONS");
    return new Response("User-agent: *\nDisallow: /\n", { headers: { "Content-Type": "text/plain" } });
  }
  for (const r of ROUTES) {
    const m = r.re.exec(path);
    if (!m) continue;
    const allow = r.method === "GET" ? "GET, HEAD, OPTIONS" : "OPTIONS, POST";
    if (method === "OPTIONS") return new Response("", { headers: { Allow: allow } });
    if (method !== r.method) return errorResponse(405, allow);
    const token = decode(m[1]);
    if (token === null) return errorResponse(404);
    return r.run(env, req, token, m[2] ? Number(m[2]) : 0);
  }
  return errorResponse(404);
}
