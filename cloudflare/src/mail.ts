import { buildMessage, okAddr, smtpSend, type Duplex } from "./smtp";
import type { Mail } from "./emails";
import type { Env } from "./env";

export type Connect = () => Duplex;

async function gmailSocket(): Promise<Duplex> {
  const { connect } = await import("cloudflare:sockets");
  return connect({ hostname: "smtp.gmail.com", port: 465 }, { secureTransport: "on", allowHalfOpen: false });
}

/** Sends through the owner's Gmail, like the Flask app. Missing secrets: logs and skips, never throws. */
export async function sendMail(env: Env, m: Mail, connect?: Connect): Promise<boolean> {
  const user = env.GMAIL_USER, pass = env.GMAIL_APP_PASSWORD;
  if (!user || !pass || !m.to) {
    console.log(`[mail skipped] ${!user || !pass ? "Gmail secrets not set" : "no address"}: ${m.subject}`);
    return false;
  }
  const cc = env.NOTIFY_ALSO || user;
  const rcpts = [m.to];
  if (cc && cc.toLowerCase() !== m.to.toLowerCase()) rcpts.push(cc);
  if (!rcpts.every(okAddr)) {
    console.log(`[mail skipped] address is not valid: ${m.subject}`);
    return false;
  }
  const message = buildMessage({
    fromName: env.FROM_NAME || "Park With Love (no reply)", user, to: m.to, cc,
    subject: m.subject, text: m.body, html: m.html, image: m.image,
  });
  try {
    const sock = connect ? connect() : await gmailSocket();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("SMTP timed out")), 30000); });
    try {
      await Promise.race([smtpSend(sock, { user, pass }, user, rcpts, message), timeout]);
    } catch (err) {
      await sock.close().catch(() => undefined);
      throw err;
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
    return true;
  } catch (err) {
    console.log("[mail error]", err instanceof Error ? err.message : String(err));
    return false;
  }
}
