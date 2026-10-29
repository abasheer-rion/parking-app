import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Tests run inside workerd with a local D1. The browser binding is never called: tests use MockDriver.
export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, PAUSE_REGISTRATIONS: "0", DRIVER: "mock", PROPERTY: "SAMPLE COURT", UNIT: "101" },
        },
      }),
    ],
    test: { setupFiles: ["./test/setup.ts"] },
  };
});
