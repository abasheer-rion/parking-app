import { beforeEach, describe, expect, it } from "vitest";
import fixture from "./fixture.json";
import mails from "./golden/mails.json";
import { failureMail, successMail } from "../src/emails";
import type { Job } from "../src/db";
import { env, loadFixture, QR_BYTES } from "./helpers";

beforeEach(loadFixture);
const PLACE = "Sample Court, unit 101";

async function row(id: number): Promise<Job> {
  return (await env.DB.prepare("SELECT * FROM jobs WHERE id=?").bind(id).first<Job>())!;
}

describe("emails match the Flask app", () => {
  for (const c of fixture.mails) {
    it(c.name, async () => {
      const want = (mails as Record<string, { to: string; subject: string; body: string; html: string; image: boolean }>)[c.name];
      const j = await row(c.job);
      const got = c.kind === "success"
        ? successMail(j, !!c.first, (j as unknown as { qr_png: unknown }).qr_png ? QR_BYTES : null, PLACE)
        : failureMail(j, !!c.first, c.reason!, !!c.gave_up);
      expect(got.to).toBe(want.to);
      expect(got.subject).toBe(want.subject);
      expect(got.body).toBe(want.body);
      expect(got.html).toBe(want.html);
      expect(!!got.image).toBe(want.image);
    });
  }
});
