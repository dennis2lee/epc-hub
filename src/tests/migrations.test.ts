import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Deploys run `supabase db push` before the new app starts, so for a short time
// the old app runs against the new schema. Migrations must therefore only add.
// These break the running app and are refused:
//   - dropping or renaming a function, table, view, type or schema
//   - dropping a column, or changing a column's type
//   - revoking privileges the app's roles use (authenticated, service_role, …)
//     on a function, table, view or sequence that existed before this migration
// Text inside $$ … $$ bodies is scanned like any other statement. Known limit:
// SQL assembled at run time (format(), ||) is not seen, so never change
// privileges or schema through dynamic SQL in a migration.
// Revoking only from `public`/`anon`, or on objects created in the same
// migration, is allowed (every grant the app uses is explicit to its role).
// A breaking change needs the maintenance procedure in doc/deploy.md (9장) and
// a header line in the migration:
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
  // Column type change: "alter column x type …" or "alter column x set data type …".
  /\balter\s+table\b[^;]*\balter\s+(column\s+)?[a-z_"]+\s+(set\s+data\s+)?type\b/i,
];

/** SQL without comments, so explanations may mention the forbidden words. */
function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

function statements(sql: string): string[] {
  return stripComments(sql)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

// An identifier, optionally schema-qualified, as PostgreSQL accepts it:
// quoted or not, with optional spaces around the dot ("public" . "f").
const PART = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*)`;
const NAME = String.raw`${PART}(?:\s*\.\s*${PART})?`;

/** public.f, "public" . "f" and f all become public.f (bare = public schema). */
function normalize(name: string): string {
  const n = name.replace(/\s*\.\s*/g, ".").replace(/"/g, "").toLowerCase();
  return n.includes(".") ? n : `public.${n}`;
}

/** Functions, procedures, tables, views and sequences a migration creates. */
export function createdObjects(sql: string): Set<string> {
  const out = new Set<string>();
  for (const s of statements(sql)) {
    const fn = new RegExp(String.raw`\bcreate\s+(or\s+replace\s+)?(function|procedure)\s+(${NAME})\s*\(`, "i").exec(s);
    if (fn) out.add(normalize(fn[3]));
    const rel =
      new RegExp(
        String.raw`\bcreate\s+(or\s+replace\s+)?(temp(orary)?\s+|unlogged\s+)?(table|view|materialized\s+view|sequence)\s+(if\s+not\s+exists\s+)?(${NAME})`,
        "i",
      ).exec(s);
    if (rel) out.add(normalize(rel[6]));
  }
  return out;
}

/** Split "a(int, text), b, c()" on top-level commas only. */
function topLevelItems(list: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      items.push(cur);
      cur = "";
    } else cur += ch;
  }
  items.push(cur);
  return items.map((x) => x.trim()).filter(Boolean);
}

/** A revoke that can take away a privilege the running app uses. */
function breakingRevoke(stmt: string, existing: Set<string>): boolean {
  const m = /\brevoke\b[\s\S]*?\bon\s+([\s\S]+?)\s+from\s+([\s\S]+?)(\s+(cascade|restrict))?$/i.exec(stmt);
  if (!m) return false;
  const roles = m[2].split(",").map((r) => r.trim().replace(/"/g, "").toLowerCase());
  if (roles.every((r) => r === "public" || r === "anon")) return false;
  const target = m[1];
  if (/^(all\s+(functions|tables|sequences|routines)\s+in\s+schema|schema)\b/i.test(target)) return true;
  // "function f(int), g" / "table t, v" / "sequence s" / bare "t": the name is
  // the leading identifier of each item; an argument list is optional.
  const list = target.replace(/^(functions?|routines?|procedures?|table|sequence)\s+/i, "");
  const names = topLevelItems(list).map((item) => new RegExp(`^${NAME}`).exec(item)?.[0] ?? "");
  return names.some((n) => n && existing.has(normalize(n)));
}

/**
 * Statements in `sql` that would break the app running during the deploy.
 * `existing` holds the functions and tables created by earlier migrations.
 */
export function breakingStatements(sql: string, existing: Set<string> = new Set()): string[] {
  return statements(sql).filter((s) => BREAKING.some((re) => re.test(s + ";")) || breakingRevoke(s, existing));
}

describe("migrations stay compatible with the running app", () => {
  const all = fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  const files = all.filter((f) => f.slice(0, 14) >= CHECK_FROM);

  it("checks at least one migration", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const f of files) {
    it(`${f} only adds, or declares a breaking change`, () => {
      const existing = new Set<string>();
      for (const earlier of all.slice(0, all.indexOf(f))) {
        for (const o of createdObjects(fs.readFileSync(path.join(DIR, earlier), "utf8"))) existing.add(o);
      }
      const sql = fs.readFileSync(path.join(DIR, f), "utf8");
      if (/^--\s*breaking-change:\s*\S/m.test(sql)) return;
      expect(breakingStatements(sql, existing)).toEqual([]);
    });
  }

  it("detects the patterns it is meant to catch", () => {
    const existing = new Set(["public.f", "private.g", "public.claims", "public.v_open", "public.seq_no"]);
    const breaking = [
      "drop function public.f(uuid);",
      "alter table public.claims drop column late;",
      "alter table public.claims drop late;",
      "alter function public.f(uuid) rename to g;",
      "alter table public.claims alter column total_cents type numeric;",
      "alter table public.claims alter total_cents set data type numeric;",
      "revoke execute on function public.f(uuid) from authenticated;",
      "revoke all on function f(uuid), private.h() from public, authenticated;",
      "revoke execute on all functions in schema private from authenticated;",
      "revoke select on public.claims from authenticated;",
      "revoke select on table claims from service_role;",
      "revoke execute on function public.f from authenticated;",
      "revoke execute on function f, private.h(int) from authenticated;",
      "revoke all on function private.g (uuid) from authenticated;",
      "revoke select on public.v_open from authenticated;",
      "revoke usage on sequence public.seq_no from authenticated;",
      // Spaces around the dot and quoted parts are the same name to PostgreSQL.
      "revoke execute on function public . f from authenticated;",
      'revoke execute on function "public" . "f" from authenticated;',
      'revoke execute on function "public"."f"(uuid) from authenticated;',
      "revoke select on public .claims from authenticated;",
      // Statements written out inside $$ bodies are scanned too.
      "do $$ begin execute 'drop function public.f(uuid)'; end $$;",
      "do $$ begin revoke execute on function public.f from authenticated; end $$;",
    ];
    for (const s of breaking) expect(breakingStatements(s, existing), s).toHaveLength(1);

    const fine = [
      "-- drop function x\ncreate or replace function f() returns int language sql as $$ select 1 $$;",
      "alter table public.claims add column x int;",
      'drop policy "p" on public.claims;',
      "alter table public.claims alter column late drop default;",
      "alter table public.claims alter column late drop not null;",
      "alter table public.claims alter column late set default false;",
      "revoke execute on all functions in schema private from public, anon;",
      "revoke all on function private.g() from public, anon;",
      "revoke all on function private.new_helper() from authenticated;",
      "revoke all on function private.new_helper from authenticated;",
      "revoke usage on sequence public.new_seq from authenticated;",
    ];
    for (const s of fine) expect(breakingStatements(s, existing), s).toEqual([]);
  });

  it("collects created functions and tables", () => {
    const sql = [
      "create or replace function private.x(a int) returns int language sql as $$ select 1 $$;",
      'create table if not exists "Claims2" (id int);',
      "create or replace view public.v_open as select 1;",
      "create sequence public.seq_no;",
      "create materialized view m as select 1;",
    ].join("\n");
    expect([...createdObjects(sql)].sort()).toEqual(["private.x", "public.claims2", "public.m", "public.seq_no", "public.v_open"]);
    expect([...createdObjects('create function "private" . "Y" (a int) returns int language sql as $$ select 1 $$;')]).toEqual([
      "private.y",
    ]);
  });
});
