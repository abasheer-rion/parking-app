// A small SMTP client for Gmail on port 465 (TLS from the start), plus the MIME builder.
// Message layout matches what Python's EmailMessage produced in the Flask app:
// text, an HTML alternative with the QR inline (cid:qr), and the QR again as an attachment.

export interface Duplex {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close(): Promise<void>;
}

export interface Envelope {
  fromName: string; user: string; to: string; cc?: string | null;
  subject: string; text: string; html?: string; image?: Uint8Array | null;
  date?: Date; boundarySeed?: string;
}

const enc = new TextEncoder();

export function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function wrap76(s: string): string {
  return s.replace(/.{1,76}/g, "$&\r\n");
}

/** Strips CR and LF so user input can never add a header. */
export function oneLine(s: string): string {
  return s.replace(/[\r\n]+/g, " ");
}

function encodeWord(s: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?utf-8?b?${b64(enc.encode(s))}?=`;
}

/** Python's email.utils.formataddr: quotes the name when it has special characters. */
export function formatAddr(name: string, addr: string): string {
  if (!name) return addr;
  // eslint-disable-next-line no-control-regex
  if (!/^[\x20-\x7e]*$/.test(name)) return `${encodeWord(name)} <${addr}>`;
  if (/[()<>@,:;.\\"[\]]/.test(name)) return `"${name.replace(/(["\\])/g, "\\$1")}" <${addr}>`;
  return `${name} <${addr}>`;
}

/** An address we are willing to hand to the SMTP server. */
export function okAddr(a: string | null | undefined): a is string {
  return !!a && /^[^\s<>"(),;:]+@[^\s<>"(),;:]+$/.test(a);
}

function textPart(type: string, s: string): string {
  return `Content-Type: ${type}; charset="utf-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64(enc.encode(s)))}`;
}

function multipart(type: string, boundary: string, parts: string[]): string {
  return `Content-Type: multipart/${type}; boundary="${boundary}"\r\n\r\n` +
    parts.map((p) => `--${boundary}\r\n${p}\r\n`).join("") + `--${boundary}--\r\n`;
}

export function buildMessage(m: Envelope): string {
  const seed = m.boundarySeed ?? crypto.randomUUID().replace(/-/g, "");
  const date = (m.date ?? new Date()).toUTCString().replace("GMT", "+0000");
  const headers = [
    `From: ${formatAddr(m.fromName, m.user)}`,
    `To: ${oneLine(m.to)}`,
    `Subject: ${encodeWord(oneLine(m.subject))}`,
  ];
  if (m.cc && m.cc.toLowerCase() !== m.to.toLowerCase()) headers.push(`Cc: ${oneLine(m.cc)}`);
  headers.push(`Date: ${date}`, `Message-ID: <${seed}@parking-app>`, "MIME-Version: 1.0");

  let body = textPart("text/plain", m.text);
  if (m.html) {
    let htmlPart = textPart("text/html", m.html);
    if (m.image) {
      const img = `Content-Type: image/png\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: inline\r\n` +
        `Content-ID: <qr>\r\n\r\n${wrap76(b64(m.image))}`;
      htmlPart = multipart("related", `rel_${seed}`, [htmlPart, img]);
    }
    body = multipart("alternative", `alt_${seed}`, [body, htmlPart]);
  }
  if (m.image) {
    const att = `Content-Type: image/png\r\nContent-Transfer-Encoding: base64\r\n` +
      `Content-Disposition: attachment; filename="parking-qr.png"\r\n\r\n${wrap76(b64(m.image))}`;
    body = multipart("mixed", `mix_${seed}`, [body, att]);
  }
  return headers.join("\r\n") + "\r\n" + body;
}

/** Reads SMTP replies line by line from the socket. */
class Replies {
  private buf = "";
  private dec = new TextDecoder();
  constructor(private reader: ReadableStreamDefaultReader<Uint8Array>) {}

  async next(): Promise<{ code: number; text: string }> {
    const lines: string[] = [];
    for (;;) {
      const i = this.buf.indexOf("\n");
      if (i >= 0) {
        const line = this.buf.slice(0, i).replace(/\r$/, "");
        this.buf = this.buf.slice(i + 1);
        lines.push(line);
        if (/^\d{3}(?: |$)/.test(line)) return { code: Number(line.slice(0, 3)), text: lines.join("\n") };
        continue;
      }
      const { value, done } = await this.reader.read();
      if (done) throw new Error("SMTP connection closed early");
      this.buf += this.dec.decode(value, { stream: true });
    }
  }
}

export interface SmtpAuth { user: string; pass: string }

/** Sends one message over an already open TLS socket. Throws on any unexpected reply. */
export async function smtpSend(sock: Duplex, auth: SmtpAuth, from: string, rcpts: string[], message: string): Promise<void> {
  const reader = sock.readable.getReader();
  const writer = sock.writable.getWriter();
  const replies = new Replies(reader);
  const send = (s: string) => writer.write(enc.encode(s));
  const expect = async (want: number[], step: string) => {
    const r = await replies.next();
    if (!want.includes(r.code)) throw new Error(`SMTP ${step} failed with ${r.code}`);
    return r;
  };
  try {
    await expect([220], "greeting");
    await send("EHLO parking-app\r\n");
    await expect([250], "EHLO");
    await send("AUTH LOGIN\r\n");
    await expect([334], "AUTH");
    await send(b64(enc.encode(auth.user)) + "\r\n");
    await expect([334], "AUTH user");
    await send(b64(enc.encode(auth.pass)) + "\r\n");
    await expect([235], "AUTH password");
    await send(`MAIL FROM:<${from}>\r\n`);
    await expect([250], "MAIL FROM");
    for (const r of rcpts) {
      await send(`RCPT TO:<${r}>\r\n`);
      await expect([250, 251], "RCPT TO");
    }
    await send("DATA\r\n");
    await expect([354], "DATA");
    const stuffed = message.replace(/\r\n/g, "\n").split("\n").map((l) => (l.startsWith(".") ? "." + l : l)).join("\r\n");
    await send(stuffed.replace(/(\r\n)?$/, "\r\n") + ".\r\n");
    await expect([250], "message");
    await send("QUIT\r\n");
    await replies.next().catch(() => undefined);
  } finally {
    reader.releaseLock();
    writer.releaseLock();
    await sock.close().catch(() => undefined);
  }
}
