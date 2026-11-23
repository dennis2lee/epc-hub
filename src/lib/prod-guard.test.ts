import { afterEach, describe, expect, it, vi } from "vitest";
import { assertNotProdFromPreview } from "./prod-guard";

describe("assertNotProdFromPreview", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("ignores local runs and production", () => {
    vi.stubEnv("VERCEL_ENV", "");
    expect(() => assertNotProdFromPreview("https://prodref.supabase.co")).not.toThrow();
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("SUPABASE_PROD_REF", "prodref");
    expect(() => assertNotProdFromPreview("https://prodref.supabase.co")).not.toThrow();
  });

  it("refuses a preview that points at production", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("SUPABASE_PROD_REF", "prodref");
    expect(() => assertNotProdFromPreview("https://prodref.supabase.co")).toThrow(/production/);
    expect(() => assertNotProdFromPreview("https://previewref.supabase.co")).not.toThrow();
  });

  it("fails closed when the prod ref is missing on a preview", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("SUPABASE_PROD_REF", "");
    expect(() => assertNotProdFromPreview("https://previewref.supabase.co")).toThrow(/SUPABASE_PROD_REF/);
  });
});
