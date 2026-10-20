import { describe, expect, it } from "vitest";
import { buildMessage, formatAddr, smtpSend, type Duplex } from "../src/smtp";
import { sendMail } from "../src/mail";
import type { Env } from "../src/env";
import { env } from "./helpers";

/** A pretend Gmail. Records every line the client sends and answers like smtp.gmail.com. */
function fakeGmail(opts: { failAt?: string } = {}) {
  const toClient = new TransformStream<Uint8Array, Uint8Array>();
  const fromClient = new TransformStream<Uint8Array, Uint8Array>();
  const w = toClient.writable.getWriter();
  const enc = new TextEncoder();
  const say = (s: string) => w.write(enc.encode(s));
  const lines: string[] = [];
  let data = "";
  let closed = false;
  const done = (async () => {
    await say("220 smtp.gmail.com ESMTP ready\r\n");
    const reader = fromClient.readable.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let inData = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === ".") { inData = false; await say("250 2.0.0 OK queued\r\n"); } else data += line + "\r\n";
          continue;
        }
        lines.push(line);
        const cmd = line.split(/[ :]/)[0].toUpperCase();
        if (opts.failAt && line.startsWith(opts.failAt)) { await say("535 5.7.8 Username and Password not accepted\r\n"); continue; }
        if (cmd === "EHLO") await say("250-smtp.gmail.com at your service\r\n250-AUTH LOGIN PLAIN\r\n250 SMTPUTF8\r\n");
        else if (cmd === "AUTH") await say("334 VXNlcm5hbWU6\r\n");
        else if (lines.length === 3) await say("334 UGFzc3dvcmQ6\r\n");
        else if (lines.length === 4) await say("235 2.7.0 Accepted\r\n");
        else if (cmd === "MAIL" || cmd === "RCPT") await say("250 2.1.0 OK\r\n");
        else if (cmd === "DATA") { inData = true; await say("354 Go ahead\r\n"); }
        else if (cmd === "QUIT") { await say("221 2.0.0 closing\r\n"); }
      }
    }
  })();
  const sock: Duplex = {
    readable: toClient.readable,
    writable: fromClient.writable,
    close: async () => { if (!closed) { closed = true; await w.close().catch(() => undefined); } },
  };
  return { sock, lines, data: () => data, done };
}

const b64 = (s: string) => btoa(s);

describe("SMTP client", () => {
  it("logs in with AUTH LOGIN and sends to the guest and the copy address", async () => {
    const g = fakeGmail();
    const msg = buildMessage({ fromName: "Park With Love (no reply)", user: "owner@example.com", to: "guest@example.com",
      cc: "owner@example.com", subject: "Hi", text: ".starts with a dot\nline two", boundarySeed: "seed" });
    await smtpSend(g.sock, { user: "owner@example.com", pass: "app-pass" }, "owner@example.com",
      ["guest@example.com", "owner@example.com"], msg);
    expect(g.lines).toEqual([
      "EHLO parking-app", "AUTH LOGIN", b64("owner@example.com"), b64("app-pass"),
      "MAIL FROM:<owner@example.com>", "RCPT TO:<guest@example.com>", "RCPT TO:<owner@example.com>", "DATA", "QUIT",
    ]);
    expect(g.data()).toContain('From: "Park With Love (no reply)" <owner@example.com>');
    expect(g.data()).toContain("Cc: owner@example.com");
  });
  it("throws on a rejected password, without the password in the error", async () => {
    const g = fakeGmail({ failAt: b64("bad-pass") });
    const msg = buildMessage({ fromName: "x", user: "u@example.com", to: "t@example.com", subject: "s", text: "t" });
    const err = await smtpSend(g.sock, { user: "u@example.com", pass: "bad-pass" }, "u@example.com", ["t@example.com"], msg)
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String(err)).toContain("535");
    expect(String(err)).not.toContain("bad-pass");
  });
  it("dot-stuffs lines that start with a dot", async () => {
    const g = fakeGmail();
    // A header line cannot start with a dot, so put one in a raw message to check stuffing.
    await smtpSend(g.sock, { user: "u", pass: "p" }, "u@example.com", ["t@example.com"], "Subject: x\r\n\r\n.hidden\r\nok");
    expect(g.data()).toBe("Subject: x\r\n\r\n..hidden\r\nok\r\n");
  });
});

describe("MIME layout, like Python's EmailMessage", () => {
  it("text + html + inline QR + QR attachment", () => {
    const m = buildMessage({ fromName: "Park With Love (no reply)", user: "o@example.com", to: "g@example.com", cc: "o@example.com",
      subject: "Parking confirmed for ABC, code X", text: "Hi", html: "<p>Hi</p>", image: new Uint8Array([1, 2, 3]), boundarySeed: "s" });
    expect(m).toMatch(/Content-Type: multipart\/mixed; boundary="mix_s"/);
    expect(m).toMatch(/Content-Type: multipart\/alternative; boundary="alt_s"/);
    expect(m).toMatch(/Content-Type: multipart\/related; boundary="rel_s"/);
    expect(m).toContain("Content-ID: <qr>");
    expect(m).toContain('Content-Disposition: attachment; filename="parking-qr.png"');
    expect(m.indexOf("text/plain")).toBeLessThan(m.indexOf("text/html"));
  });
  it("failure mail has no attachment and no Cc when the guest is the owner", () => {
    const m = buildMessage({ fromName: "n", user: "o@example.com", to: "O@example.com", cc: "o@example.com",
      subject: "s\r\nBcc: evil@example.com", text: "t", html: "<p>t</p>" });
    expect(m).not.toContain("multipart/mixed");
    expect(m).not.toContain("Cc:");
    expect(m).not.toMatch(/\r\nBcc:/);
  });
  it("formataddr quoting", () => {
    expect(formatAddr("Park With Love (no reply)", "a@b.c")).toBe('"Park With Love (no reply)" <a@b.c>');
    expect(formatAddr("Plain Name", "a@b.c")).toBe("Plain Name <a@b.c>");
  });
});

describe("sendMail", () => {
  const mail = { to: "guest@example.com", subject: "Hello", body: "Hi" };
  it("skips quietly when the Gmail secrets are missing", async () => {
    const e = { ...env, GMAIL_USER: undefined, GMAIL_APP_PASSWORD: undefined } as Env;
    let used = false;
    expect(await sendMail(e, mail, () => { used = true; throw new Error("no"); })).toBe(false);
    expect(used).toBe(false);
  });
  it("sends with the secrets and copies the owner", async () => {
    const g = fakeGmail();
    const e = { ...env, GMAIL_USER: "owner@example.com", GMAIL_APP_PASSWORD: "pw" } as Env;
    expect(await sendMail(e, mail, () => g.sock)).toBe(true);
    expect(g.lines).toContain("RCPT TO:<owner@example.com>");
  });
  it("returns false instead of crashing on an SMTP error", async () => {
    const g = fakeGmail({ failAt: b64("pw") });
    const e = { ...env, GMAIL_USER: "owner@example.com", GMAIL_APP_PASSWORD: "pw" } as Env;
    expect(await sendMail(e, mail, () => g.sock)).toBe(false);
  });
  it("refuses an address that could break the SMTP command", async () => {
    const e = { ...env, GMAIL_USER: "owner@example.com", GMAIL_APP_PASSWORD: "pw" } as Env;
    expect(await sendMail(e, { ...mail, to: "a@b.c>\r\nRCPT TO:<x@y.z" }, () => { throw new Error("must not connect"); })).toBe(false);
  });
});
