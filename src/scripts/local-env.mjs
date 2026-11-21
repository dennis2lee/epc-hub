// Write .env.local from the running local Supabase stack (used locally and in CI).
// Usage: node src/scripts/local-env.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const raw = execFileSync("npx", ["--no-install", "supabase", "status", "--workdir", "src", "-o", "env"], {
  encoding: "utf8",
});
const env = Object.fromEntries(
  raw
    .split("\n")
    .map((line) => /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);

const existing = fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf8") : "";
const keep = existing
  .split("\n")
  .filter((l) => l && !/^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY|SUPABASE_SECRET_KEY)=/.test(l));

const lines = [
  `NEXT_PUBLIC_SUPABASE_URL=${env.API_URL ?? "http://127.0.0.1:54321"}`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${env.PUBLISHABLE_KEY ?? env.ANON_KEY ?? ""}`,
  `SUPABASE_SECRET_KEY=${env.SECRET_KEY ?? env.SERVICE_ROLE_KEY ?? ""}`,
  ...keep,
];
fs.writeFileSync(".env.local", lines.join("\n") + "\n");
console.log("wrote .env.local (keys not printed)");
