// The friend page, ported line for line from the Flask app's PAGE template.
// Whitespace matches the Jinja output, so test/golden can compare them directly.
// The "Past stays" card is new here: the Flask app never had it.
import { fmt } from "./time";
import type { Friend, Job, Profile } from "./db";

/** A finished stay. No column counts renewals, so none is shown. */
export type PastStay = Pick<Job, "id" | "plate" | "start_ts" | "end_ts" | "confirmation">;

export const STATES = ["TX", "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY",
  "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH",
  "OK", "OR", "PA", "RI", "SC", "SD", "TN", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC"];

/** Jinja autoescape. A missing value prints "None", as it does in the Flask app. */
export function e(v: unknown): string {
  const s = v === null || v === undefined ? "None" : String(v);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&#34;").replace(/'/g, "&#39;");
}

/** Python str.title(), used for the property name. */
export function pyTitle(s: string): string {
  let out = "";
  let prevCased = false;
  for (const ch of s) {
    const cased = ch.toLowerCase() !== ch.toUpperCase();
    out += cased ? (prevCased ? ch.toLowerCase() : ch.toUpperCase()) : ch;
    prevCased = cased;
  }
  return out;
}

export interface PageData {
  friend: Friend;
  profiles: Profile[];
  active: (Job & { has_qr: number })[];
  past: PastStay[];
  lastEmail: string;
  notice?: string | null;
  error?: string | null;
  maxDays: number;
  unit: string;
  prop: string;
}

const HEAD_STYLE = `<link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap" rel="stylesheet">
<style>
 :root{--pink:#ff8fb8;--hot:#ff4f8b;--cream:#fff3f8;--ink:#5b2a45;--mint:#6fdcb6}
 *{box-sizing:border-box;image-rendering:pixelated}
 body{font-family:'VT323',monospace;font-size:21px;background:var(--pink);color:var(--ink);margin:0;
  background-image:radial-gradient(#ffb3cf 2px,transparent 2px);background-size:22px 22px}
 main{max-width:460px;margin:0 auto;padding:22px 14px 70px}
 h1{font-family:'Press Start 2P',monospace;font-size:17px;line-height:1.5;margin:6px 0 6px;color:#fff;
  text-shadow:3px 3px 0 var(--hot);text-align:center}
 p.sub{margin:0 0 18px;text-align:center;color:#fff;text-shadow:1px 1px 0 var(--hot)}
 .card{background:var(--cream);padding:16px;margin:16px 0;border:4px solid var(--ink);
  box-shadow:6px 6px 0 var(--hot)}
 .card>b,.card b.t{font-family:'Press Start 2P',monospace;font-size:11px;color:var(--hot);display:block;margin-bottom:6px}
 label{display:block;margin:10px 0 3px}
 input,select{width:100%;font-family:'VT323',monospace;font-size:22px;padding:8px 10px;color:var(--ink);
  background:#fff;border:3px solid var(--ink);border-radius:0;outline:none}
 input:focus,select:focus{border-color:var(--hot);box-shadow:3px 3px 0 var(--pink)}
 button{width:100%;font-family:'Press Start 2P',monospace;font-size:11px;padding:14px 8px;margin-top:14px;
  background:var(--hot);color:#fff;border:3px solid var(--ink);border-radius:0;box-shadow:4px 4px 0 var(--ink);cursor:pointer}
 button:active{transform:translate(3px,3px);box-shadow:1px 1px 0 var(--ink)}
 button.alt{background:#fff;color:var(--ink);margin-top:10px}
 .row{display:flex;gap:10px}.row>div{flex:1}
 .ok{color:#0d8a62}.bad{color:#c0143c}.mut{opacity:.75}
 .who{border-top:3px dashed var(--pink);padding-top:12px;margin-top:12px}.who:first-of-type{border-top:0;padding-top:0;margin-top:0}
 .name{font-family:'Press Start 2P',monospace;font-size:12px}
 details{margin-top:10px}summary{cursor:pointer;color:var(--hot)}
 .heart{display:inline-block;animation:beat 1.2s steps(2) infinite}
 @keyframes beat{50%{transform:scale(1.25)}}
</style></head><body><main>
`;

const PLAIN_STATES = STATES.map((s) => `<option>${s}</option>`).join("");

function stateOptions(selected: string | null): string {
  return STATES.map((s) => `<option ${s === selected ? "selected" : ""}>${s}</option>`).join("");
}

export function renderPage(d: PageData): string {
  const tok = encodeURIComponent(d.friend.token);
  const base = `/u/${tok}`;
  const anyPending = d.active.some((j) => j.status === "pending" && !j.last_ok_ts);
  const o: string[] = [];
  o.push(`
<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Guest parking</title>
${anyPending ? `<meta http-equiv="refresh" content="6">` : ""}
${HEAD_STYLE}<h1><span class="heart">♥</span> Park With Love <span class="heart">♥</span></h1><p class="sub">Hi ${e(d.friend.name)}, saving you a spot at ${e(d.prop)}, unit ${e(d.unit)}</p>

${d.notice ? `<div class="card"><span class="ok">${e(d.notice)}</span></div>` : ""}
${d.error ? `<div class="card"><span class="bad">${e(d.error)}</span></div>` : ""}

<div class="card"><b class="t">♥ Who's coming</b>
`);
  for (const p of d.profiles) {
    o.push(`
 <div class="who">
  <span class="name">${e(p.name)}</span><br>
  <span class="mut">${p.plate ? `${e(p.plate)} ${e(p.state)} · ${e(p.color)} ${e(p.make)} ${e(p.model)}` : "No car saved yet"}</span>
  ${p.plate && p.email ? `
  <form method="post" action="${base}/profile/${p.id}/go">
   <div class="row"><div style="max-width:110px"><label>Days</label><input name="days" type="number" min="1" max="${d.maxDays}" value="1"></div>
   <div><button>Save my spot ♥</button></div></div></form>
  ` : `<br><span class="bad">Open Edit and add a car and an email to register.</span>`}
  <details><summary>Edit</summary>
   <form method="post" action="${base}/profile/${p.id}/save">
    <label>Name</label><input name="name" required value="${e(p.name)}">
    <label>Email, for problem alerts</label><input name="email" type="email" value="${e(p.email)}">
    <div class="row"><div><label>Plate</label><input name="plate" autocapitalize="characters" value="${e(p.plate)}"></div>
    <div><label>State</label><select name="state">${stateOptions(p.state)}</select></div></div>
    <div class="row"><div><label>Make</label><input name="make" value="${e(p.make)}"></div><div><label>Model</label><input name="model" value="${e(p.model)}"></div></div>
    <label>Color</label><input name="color" value="${e(p.color)}">
    <button>Save changes</button></form>
   <form method="post" action="${base}/profile/${p.id}/delete"><button class="alt">Remove ${e(p.name)}</button></form>
  </details>
 </div>
`);
  }
  o.push(`
 <details><summary>Add someone</summary>
  <form method="post" action="${base}/profile/new">
   <label>Name</label><input name="name" required>
   <label>Email, for problem alerts</label><input name="email" type="email">
   <div class="row"><div><label>Plate</label><input name="plate" autocapitalize="characters"></div>
   <div><label>State</label><select name="state">${PLAIN_STATES}</select></div></div>
   <div class="row"><div><label>Make</label><input name="make"></div><div><label>Model</label><input name="model"></div></div>
   <label>Color</label><input name="color">
   <button>Add</button></form>
 </details>
</div>

`);
  for (const j of d.active) {
    let state: string;
    if (j.status === "pending" && !j.last_ok_ts) {
      state = `<span class="mut">Saving your spot now, this page updates on its own.</span>
 `;
    } else if (j.status === "failed") {
      state = `<span class="bad">Failed: ${e(j.error)}</span>
 `;
    } else {
      state = `<span class="ok">♥ You are all set</span><br>
  <span class="mut">Spot saved until ${e(fmt(j.expires_ts))}. Stay ends ${e(fmt(j.end_ts))}.</span>
  ${j.confirmation ? `<br><label>Confirmation code</label><b style="word-break:break-all">${e(j.confirmation)}</b>` : ""}
  ${j.has_qr ? `<br><img src="${base}/qr/${j.id}" alt="QR code" style="width:200px;max-width:100%;margin-top:8px;border:3px solid var(--ink);background:#fff">` : ""}
  `;
    }
    o.push(`
<div class="card">
 <b class="t" style="font-size:13px">${e(j.plate)}</b> <span class="mut">${e(j.make)} ${e(j.model)}</span><br>
 ${state}
 <form method="post" action="${base}/stop/${j.id}"><button class="alt">Done staying</button></form>
</div>
`);
  }
  o.push(`
<div class="card"><b class="t">♥ Past stays</b>
${d.past.length ? d.past.map((j) => `
 <div class="who">
  <span class="name">${e(j.plate)}</span><br>
  <span class="mut">${e(fmt(j.start_ts))} to ${e(fmt(j.end_ts))}</span>${j.confirmation ? `<br>
  <span class="mut">Code ${e(j.confirmation)}</span>` : ""}
 </div>`).join("") : `<span class="mut">No past stays yet.</span>`}
</div>
`);
  o.push(`


<div class="card"><b class="t">♥ New ride</b>
<form method="post" action="${base}/register">
 <label>Your email, for problem alerts</label><input name="email" type="email" required value="${e(d.lastEmail)}">
 <div class="row"><div><label>Plate</label><input name="plate" required autocapitalize="characters"></div>
 <div><label>State</label><select name="state" required>${PLAIN_STATES}</select></div></div>
 <div class="row"><div><label>Make</label><input name="make" required></div><div><label>Model</label><input name="model" required></div></div>
 <label>Color</label><input name="color" required>
 <label>Days staying (up to ${d.maxDays})</label><input name="days" type="number" min="1" max="${d.maxDays}" value="1" required>
 <button>Save my spot ♥</button></form></div>
</main></body></html>`);
  return o.join("");
}

// Werkzeug's default error and redirect pages, so the Worker answers exactly like Flask did.
export const NOT_FOUND = `<!doctype html>
<html lang=en>
<title>404 Not Found</title>
<h1>Not Found</h1>
<p>The requested URL was not found on the server. If you entered the URL manually please check your spelling and try again.</p>
`;
export const NOT_ALLOWED = `<!doctype html>
<html lang=en>
<title>405 Method Not Allowed</title>
<h1>Method Not Allowed</h1>
<p>The method is not allowed for the requested URL.</p>
`;
export const BAD_REQUEST = `<!doctype html>
<html lang=en>
<title>400 Bad Request</title>
<h1>Bad Request</h1>
<p>The browser (or proxy) sent a request that this server could not understand.</p>
`;

export function redirectBody(loc: string): string {
  const l = e(loc);
  return `<!doctype html>
<html lang=en>
<title>Redirecting...</title>
<h1>Redirecting...</h1>
<p>You should be redirected automatically to the target URL: <a href="${l}">${l}</a>. If not, click the link.
`;
}
