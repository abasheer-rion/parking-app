// Email wording and look, ported from the Flask app's notify_success, notify_failure and pink_email.
import { fmt } from "./time";
import type { Job } from "./db";

export interface Mail { to: string; subject: string; body: string; html?: string; image?: Uint8Array | null }

export function carLine(j: Pick<Job, "plate" | "color" | "make" | "model">): string {
  return `${j.plate} (${j.color} ${j.make} ${j.model})`;
}

export function pinkEmail(status: string, ok: boolean, who: string, lead: string, rows: [string, string][],
  code: string | null = null, qr = false, note = ""): string {
  const ink = "#5b2a45", hot = "#ff4f8b", pink = "#ff8fb8", cream = "#fff3f8";
  const mono = "'Press Start 2P','Courier New',Courier,monospace";
  const body = "'Courier New',Courier,monospace";
  const colour = ok ? "#0d8a62" : "#c0143c";
  const rowsHtml = rows.map(([k, v]) =>
    `<tr><td style="padding:6px 0;border-top:2px dashed ${pink}">` +
    `<div style="font:12px ${body};color:${ink};opacity:.75;text-transform:uppercase;letter-spacing:1px">${k}</div>` +
    `<div style="font:bold 16px ${body};color:${ink}">${v}</div></td></tr>`).join("");
  const codeHtml = code
    ? `<div style="margin:16px 0 4px;font:12px ${body};color:${ink};text-transform:uppercase;letter-spacing:1px">Confirmation code</div>` +
      `<div style="background:#fff;border:3px solid ${ink};padding:12px;font:bold 20px ${body};color:${hot};` +
      `word-break:break-all;letter-spacing:1px">${code}</div>`
    : "";
  const qrHtml = qr
    ? `<div style="margin:16px 0 0"><span style="display:inline-block;background:#fff;border:3px solid ${ink};padding:10px">` +
      `<img src="cid:qr" width="220" height="220" alt="QR code" style="display:block"></span></div>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:${pink}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${pink}"><tr><td align="center" style="padding:24px 12px">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px">
  <tr><td align="center" style="padding:6px 0 16px;font:15px/1.6 ${mono};color:#fff;text-shadow:3px 3px 0 ${hot}">&hearts; PARK WITH LOVE &hearts;</td></tr>
  <tr><td style="background:${hot};padding:0 7px 7px 0">
   <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${cream};border:3px solid ${ink}"><tr><td style="padding:20px">
    <div style="font:12px/1.6 ${mono};color:${colour}">${status}</div>
    <p style="margin:12px 0 4px;font:17px/1.5 ${body};color:${ink}">Hi ${who},</p>
    <p style="margin:0 0 14px;font:17px/1.5 ${body};color:${ink}">${lead}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowsHtml}</table>
    ${codeHtml}${qrHtml}
    <p style="margin:18px 0 0;font:15px/1.5 ${body};color:${ink}">${note}</p>
   </td></tr></table>
  </td></tr>
  <tr><td align="center" style="padding:14px 0 0;font:13px ${body};color:#fff">Sent by Park With Love. Replies are not read.</td></tr>
 </table>
</td></tr></table></body></html>`;
}

/** Python's reason[:n], counted in code points. */
function cut(s: string, n: number): string {
  return Array.from(s).slice(0, n).join("");
}

/** j is the row as it is after the update, like the Flask app re-reading it. */
export function successMail(j: Job, first: boolean, qr: Uint8Array | null, place: string): Mail {
  const who = j.who || "there";
  const more = (j.end_ts - (j.expires_ts || 0)) > 1800;
  const nxt = more
    ? "The app will try to renew right after this permit ends, and you will get another email with the result."
    : "This covers the last day of the stay, so no renewal is planned.";
  const subject = first ? `Parking confirmed for ${j.plate}, code ${j.confirmation}`
    : `Parking renewed for ${j.plate}, new code ${j.confirmation}`;
  const lead = first ? "Your guest parking is confirmed." : "Your guest parking was renewed for the next day.";
  const body = `Hi ${who},\n\n${lead}\n\nProperty: ${place}\n` +
    `Car: ${carLine(j)}\nConfirmation code: ${j.confirmation}\n` +
    `Covered until: ${fmt(j.expires_ts)}\nStay ends: ${fmt(j.end_ts)}\n\n` +
    `The QR code is attached. Show it or the code if anyone asks.\n\n${nxt}\n`;
  const html = pinkEmail(first ? "&hearts; YOU ARE ALL SET" : "&hearts; RENEWED FOR THE NEXT DAY", true, who, lead,
    [["Property", place], ["Car", carLine(j)], ["Covered until", fmt(j.expires_ts)], ["Stay ends", fmt(j.end_ts)]],
    j.confirmation, !!qr, nxt);
  return { to: j.email, subject, body, html, image: qr };
}

export function failureMail(j: Job, firstTry: boolean, reason: string, gaveUp: boolean): Mail {
  const who = j.who || "there";
  let subject: string, lead: string;
  if (firstTry) {
    subject = `Could not register parking for ${j.plate}`;
    lead = `The app could not register ${carLine(j)} for guest parking.`;
  } else {
    subject = `Could not renew parking for ${j.plate}`;
    lead = `The app could not renew parking for ${carLine(j)} for the next day.`;
  }
  const tail = gaveUp
    ? "It has stopped trying. Open your link to register again, or register by hand on the property's site."
    : "It will try again in about 10 minutes and email you if that works.";
  const cover = j.expires_ts && !firstTry ? `\nCoverage ran until: ${fmt(j.expires_ts)}\n` : "";
  const body = `Hi ${who},\n\n${lead}\n${cover}\nReason: ${cut(reason, 300)}\n\n${tail}\n`;
  const rows: [string, string][] = [["Car", carLine(j)]];
  if (j.expires_ts && !firstTry) rows.push(["Coverage ran until", fmt(j.expires_ts)]);
  rows.push(["What happened", cut(reason, 200).replace(/</g, "").replace(/>/g, "")]);
  const html = pinkEmail("NEEDS A LOOK", false, who, lead, rows, null, false, tail);
  return { to: j.email, subject, body, html };
}
