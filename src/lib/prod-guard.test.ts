import { afterEach, describe, expect, it, vi } from "vitest";
import { assertNotProdFromPreview } from "./prod-guard";

describe("assertNotProdFromPreview", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("allows local development against the local stack", () => {
    vi.stubEnv("APP_ENV", "");
    expect(() => assertNotProdFromPreview("http://127.0.0.1:54321")).not.toThrow();
  });

  it("refuses a non-production run that points at the production API", () => {
    vi.stubEnv("APP_ENV", "");
    expect(() => assertNotProdFromPreview("https://api.epcsj-hub.org")).toThrow(/production/);
    vi.stubEnv("APP_ENV", "staging");
    expect(() => assertNotProdFromPreview("https://api.epcsj-hub.org/")).toThrow(/production/);
  });

  it("lets the production server use it", () => {
    vi.stubEnv("APP_ENV", "production");
    expect(() => assertNotProdFromPreview("https://api.epcsj-hub.org")).not.toThrow();
  });

  it("honours an overridden production host", () => {
    vi.stubEnv("APP_ENV", "");
    vi.stubEnv("PROD_SUPABASE_HOST", "api.example.org");
    expect(() => assertNotProdFromPreview("https://api.example.org")).toThrow();
    expect(() => assertNotProdFromPreview("https://api.epcsj-hub.org")).not.toThrow();
  });
});
