import { applyD1Migrations, env } from "cloudflare:test";

const e = env as unknown as { DB: D1Database; TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1]; BROWSER: unknown };
await applyD1Migrations(e.DB, e.TEST_MIGRATIONS);

// wrangler.jsonc gives tests a working local browser. Replace it, so no test can ever open the
// property's site, even by mistake. Tests use MockDriver or a fake page instead.
e.BROWSER = { fetch: () => { throw new Error("no browser in tests"); } };
