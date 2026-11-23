// Weekly backup by the tech contact (doc/operations.md 7장, D27): database dump
// plus every receipt file, renamed by claim number, then encrypted with age.
// Supabase's own daily backups (Pro) do not include Storage files.
//
// Usage (one line):
//   node --env-file=<backup env file> src/scripts/backup.mjs
// Environment:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY  the project to back up
//   BACKUP_DB_URL        postgres connection string (omit for the local stack)
//   BACKUP_AGE_RECIPIENT age public key; the private key is held by two people
//   BACKUP_DIR           output folder (default: build/backup-<date>)
//   BACKUP_PLAIN=1       local test only: skip encryption
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

const url = need("NEXT_PUBLIC_SUPABASE_URL");
const key = need("SUPABASE_SECRET_KEY");
const recipient = process.env.BACKUP_AGE_RECIPIENT ?? "";
const plain = process.env.BACKUP_PLAIN === "1";
if (!recipient && !plain) throw new Error("Set BACKUP_AGE_RECIPIENT (or BACKUP_PLAIN=1 for a local test)");

const stamp = new Date().toISOString().slice(0, 10);
const out = path.resolve(process.env.BACKUP_DIR ?? `build/backup-${stamp}`);
fs.mkdirSync(path.join(out, "receipts"), { recursive: true });

// 1. Database: schema, then data of the schemas the app uses (auth for logins,
//    storage for the receipt rows the attachments point at).
const remote = process.env.BACKUP_DB_URL ? [`--remote=${process.env.BACKUP_DB_URL}`] : [];
const dump = (args, file) =>
  execFileSync("npx", ["--no-install", "supabase", "db", "dump", "--workdir", "src", ...remote, ...args, "-f", path.join(out, file)], {
    stdio: ["ignore", "ignore", "inherit"],
  });
dump([], "schema.sql");
dump(["--data-only", "--use-copy", "-s", "public,private,auth,storage"], "data.sql");
console.log("database dumped");

// 2. Receipts: every file, named <claim_no>_<n>.<ext>, plus a manifest that
//    maps each file back to its claim and storage path.
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: rows, error } = await db
  .from("attachments")
  .select("id, storage_path, sha256, created_at, claim:claims(claim_no, status)")
  .order("created_at");
if (error) throw new Error(`attachments: ${error.message}`);

const manifest = [["file", "claim_no", "claim_status", "storage_path", "sha256"]];
const seen = new Map();
let files = 0;
for (const r of rows) {
  const claimNo = r.claim?.claim_no ?? "draft";
  const n = (seen.get(claimNo) ?? 0) + 1;
  seen.set(claimNo, n);
  const ext = path.extname(r.storage_path) || ".bin";
  const name = `${claimNo}_${n}${ext}`;
  const { data: blob, error: dlErr } = await db.storage.from("receipts").download(r.storage_path);
  if (dlErr) {
    // A removed file is still listed so the gap is visible.
    manifest.push([`MISSING:${name}`, claimNo, r.claim?.status ?? "", r.storage_path, r.sha256]);
    continue;
  }
  fs.writeFileSync(path.join(out, "receipts", name), Buffer.from(await blob.arrayBuffer()));
  manifest.push([name, claimNo, r.claim?.status ?? "", r.storage_path, r.sha256]);
  files++;
}
fs.writeFileSync(
  path.join(out, "receipts", "manifest.csv"),
  manifest.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n") + "\r\n",
);
console.log(`receipts: ${files} files, ${rows.length - files} missing`);

// 3. Encrypt into one file; remove the plain copy.
if (!plain) {
  const archive = `${out}.tar`;
  execFileSync("tar", ["-cf", archive, "-C", path.dirname(out), path.basename(out)]);
  execFileSync("age", ["-r", recipient, "-o", `${archive}.age`, archive]);
  fs.rmSync(archive);
  fs.rmSync(out, { recursive: true, force: true });
  console.log(`wrote ${archive}.age — copy it to church storage (doc/operations.md 7장)`);
} else {
  console.log(`wrote ${out} (NOT encrypted; local test only)`);
}
