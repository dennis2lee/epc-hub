import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Deploys run `supabase db push` before the new app starts, so for a short time
// the old app runs against the new schema. Migrations must therefore only add:
// a dropped or renamed function, table, column, view or type breaks the running
// app ("function does not exist"). A breaking change needs the maintenance
// procedure in doc/deploy.md (9장) and a header line in the migration:
//   -- breaking-change: <why, and the maintenance window used>
// Migrations written before the first production deploy are exempt.
const CHECK_FROM = "20261123000100";
const DIR = path.resolve(__dirname, "../supabase/migrations");

const BREAKING = [
  /\bdrop\s+(function|procedure|table|view|materialized\s+view|type|schema)\b/i,
  /\balter\s+table\b[^;]*\bdrop\s+column\b/i,
  // "drop <name>" without the COLUMN keyword; not "drop default", "drop not null"…
  /\balter\s+table\b[^;]*\bdrop\s+(?!column\b|constraint\b|default\b|not\b|identity\b|expression\b)[a-z_"]+\s*(cascade|restrict)?\s*(,|;|$)/i,
  /\balter\s+(table|function|view|type)\b[^;]*\brename\b/i,
];

/** SQL without comments, so explanations may mention the forbidden words. */
function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

export function breakingStatements(sql: string): string[] {
  return stripComments(sql)
    .split(";")
    .map((s) => s.trim())
    .filter((s) => BREAKING.some((re) => re.test(s + ";")));
}

describe("migrations stay compatible with the running app", () => {
  const files = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".sql") && f.slice(0, 14) >= CHECK_FROM)
    .sort();

  it("checks at least one migration", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const f of files) {
    it(`${f} only adds, or declares a breaking change`, () => {
      const sql = fs.readFileSync(path.join(DIR, f), "utf8");
      if (/^--\s*breaking-change:\s*\S/m.test(sql)) return;
      expect(breakingStatements(sql)).toEqual([]);
    });
  }

  it("detects the patterns it is meant to catch", () => {
    expect(breakingStatements("drop function public.f(uuid);")).toHaveLength(1);
    expect(breakingStatements("alter table public.claims drop column late;")).toHaveLength(1);
    expect(breakingStatements("alter function public.f(uuid) rename to g;")).toHaveLength(1);
    expect(breakingStatements("-- drop function x\ncreate or replace function f() returns int language sql as $$ select 1 $$;")).toEqual([]);
    expect(breakingStatements("alter table public.claims add column x int;")).toEqual([]);
    expect(breakingStatements("alter table public.claims drop late;")).toHaveLength(1);
    expect(breakingStatements("drop policy \"p\" on public.claims;")).toEqual([]);
    expect(breakingStatements("alter table public.claims alter column late drop default;")).toEqual([]);
    expect(breakingStatements("alter table public.claims alter column late drop not null;")).toEqual([]);
  });
});
