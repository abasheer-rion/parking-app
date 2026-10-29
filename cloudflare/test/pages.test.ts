import { beforeEach, describe, expect, it } from "vitest";
import page1 from "./golden/page-1.html?raw";
import page2 from "./golden/page-2.html?raw";
import pageErr from "./golden/page-error-days.html?raw";
import notFound from "./golden/404.html?raw";
import { call, env, loadFixture, post, QR_BYTES } from "./helpers";

beforeEach(loadFixture);

describe("pages match the Flask app byte for byte", () => {
  it("friend page with profiles and jobs", async () => {
    const r = await call("/u/tok-alpha-123");
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(await r.text()).toBe(page1);
  });
  it("empty friend page", async () => {
    expect(await (await call("/u/tok-empty-456")).text()).toBe(page2);
  });
  it("error page for a bad days value", async () => {
    const r = await post("/u/tok-alpha-123/register", { days: "abc" });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe(pageErr);
  });
  it("404 page", async () => {
    const r = await call("/nope");
    expect(r.status).toBe(404);
    expect(await r.text()).toBe(notFound);
  });
});

describe("headers and simple routes", () => {
  it("robots.txt", async () => {
    const r = await call("/robots.txt");
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("text/plain");
    expect(await r.text()).toBe("User-agent: *\nDisallow: /\n");
    expect(r.headers.get("Cache-Control")).toBeNull();
  });
  it("security headers on every answer, no-store under /u/", async () => {
    for (const path of ["/robots.txt", "/u/tok-alpha-123", "/u/missing", "/"]) {
      const r = await call(path);
      expect(r.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
      expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(r.headers.get("X-Frame-Options")).toBe("DENY");
      expect(r.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(r.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
      expect(r.headers.get("Cache-Control")).toBe(path.startsWith("/u/") ? "no-store" : null);
    }
  });
  it("unknown token, trailing slash and other paths are 404", async () => {
    for (const p of ["/u/not-a-real-token", "/u/tok-alpha-123/", "/u/tok-alpha-123/qr/abc", "/wp-login.php", "/u/", "/start/"]) {
      expect((await call(p)).status, p).toBe(404);
    }
  });
  it("wrong method is 405", async () => {
    expect((await call("/u/tok-alpha-123/register")).status).toBe(405);
    expect((await call("/u/tok-alpha-123", { method: "POST" })).status).toBe(405);
  });
  it("HEAD works without a body", async () => {
    const r = await call("/u/tok-alpha-123", { method: "HEAD" });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("");
  });
});

describe("QR images from D1", () => {
  it("serves the stored bytes", async () => {
    const r = await call("/u/tok-alpha-123/qr/2");
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(QR_BYTES);
  });
  it("404 when there is no QR, or the job is someone else's", async () => {
    expect((await call("/u/tok-alpha-123/qr/5")).status).toBe(404);
    expect((await call("/u/tok-alpha-123/qr/999")).status).toBe(404);
    expect((await call("/u/tok-empty-456/qr/2")).status).toBe(404);
  });
  it("no QR bytes on the page itself", async () => {
    const r = await call("/u/tok-alpha-123");
    expect(await r.text()).toContain('<img src="/u/tok-alpha-123/qr/2"');
    expect(env).toBeTruthy();
  });
});
