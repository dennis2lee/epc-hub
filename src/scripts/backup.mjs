// Nightly backup on the Mac mini (D44, D47): database dump plus every receipt
// file (renamed by claim number, hash-checked), then encrypted with age.
// Run by src/ops/bin/backup-nightly.sh; also usable by hand.
//
// Environment:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY  where to read receipts (local gateway)
//   BACKUP_DB_URL        postgres connection string (omit for the local dev stack)
//   BACKUP_AGE_RECIPIENT age public key; the private key is never on the server
//   BACKUP_DIR           output folder (default: build/backup-<date>)
//   SUPABASE_DIR         self-hosted install folder, to record its version
//   BACKUP_COUNT_FILE    remembers the last receipt count; a drop fails the run
//   BACKUP_PLAIN=1       local test only: skip encryption
//
// Exit codes: 0 ok; 1 failed (no archive kept); 3 archive written but receipts
// are missing or damaged (the caller still uploads it, then raises an alert).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
const archive = `${out}.tar`;

// Never leave plaintext (auth tables, receipts) on disk after a failure.
function cleanupPlain() {
  fs.rmSync(out, { recursive: true, force: true });
  fs.rmSync(archive, { force: true });
}

// Run a command without ever echoing its arguments (the DB URL holds a password).
function run(cmd, args, label) {
  try {
    execFileSync(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
  } catch (err) {
    const secret = process.env.BACKUP_DB_URL;
    const stderr = String(err.stderr ?? "").split(secret || "\u0000").join("***");
    throw new Error(`${label} failed: ${stderr.trim().split("\n").slice(-3).join(" | ")}`);
  }
}

let damaged = 0;
try {
  fs.mkdirSync(path.join(out, "receipts"), { recursive: true, mode: 0o700 });

  // 1. Database: schema, then data of the schemas the app uses (auth for
  //    logins, storage for the receipt rows the attachments point at).
  const remote = process.env.BACKUP_DB_URL ? [`--remote=${process.env.BACKUP_DB_URL}`] : [];
  const dump = (args, file) =>
    run("npx", ["--no-install", "supabase", "db", "dump", "--workdir", "src", ...remote, ...args, "-f", path.join(out, file)], `dump ${file}`);
  dump([], "schema.sql");
  dump(["--data-only", "--use-copy", "-s", "public,private,auth,storage"], "data.sql");
  console.log("database dumped");

  // 2. Receipts: every attachment row, read page by page (the REST API returns
  //    at most 1000 rows at a time), each file checked against its sha256.
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const rows = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await db
      .from("attachments")
      .select("id, storage_path, sha256, created_at, claim:claims(claim_no, status)")
      .order("created_at")
      .order("id")
      .range(from, from + 499);
    if (error) throw new Error(`attachments: ${error.message}`);
    rows.push(...data);
    if (data.length < 500) break;
  }

  const manifest = [["file", "claim_no", "claim_status", "storage_path", "sha256", "check"]];
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
      // Only "not found" is a missing file; anything else (storage down,
      // timeout) fails the whole run so it is retried, not silently skipped.
      const status = dlErr.status ?? dlErr.statusCode ?? dlErr.originalError?.status;
      const notFound = status === 404 || status === 400 || /not.?found/i.test(dlErr.message ?? "");
      if (!notFound) throw new Error(`receipt ${r.storage_path}: ${dlErr.message}`);
      manifest.push([`MISSING:${name}`, claimNo, r.claim?.status ?? "", r.storage_path, r.sha256, "missing"]);
      damaged++;
      continue;
    }
    const bytes = Buffer.from(await blob.arrayBuffer());
    const sha = createHash("sha256").update(bytes).digest("hex");
    const check = sha === r.sha256 ? "ok" : "sha256_mismatch";
    if (check !== "ok") damaged++;
    fs.writeFileSync(path.join(out, "receipts", name), bytes, { mode: 0o600 });
    manifest.push([name, claimNo, r.claim?.status ?? "", r.storage_path, r.sha256, check]);
    files++;
  }
  fs.writeFileSync(
    path.join(out, "receipts", "manifest.csv"),
    manifest.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n") + "\r\n",
  );
  console.log(`receipts: ${files} files, ${damaged} missing or damaged`);

  // A drop in the number of receipts means rows or files disappeared.
  const countFile = process.env.BACKUP_COUNT_FILE;
  if (countFile) {
    const last = fs.existsSync(countFile) ? Number(fs.readFileSync(countFile, "utf8")) : 0;
    if (rows.length < last) {
      console.error(`receipt rows dropped from ${last} to ${rows.length}`);
      damaged++;
    } else {
      fs.writeFileSync(countFile, `${rows.length}\n`);
    }
  }

  // Which release and which Supabase version made this backup: a restore must
  // use the same ones.
  fs.writeFileSync(path.join(out, "release.txt"), `${process.env.RELEASE_SHA ?? path.basename(process.cwd())}\n`);
  const versionFile = process.env.SUPABASE_DIR ? path.join(process.env.SUPABASE_DIR, ".supabase-version") : "";
  fs.writeFileSync(path.join(out, "supabase-version.txt"), versionFile && fs.existsSync(versionFile) ? fs.readFileSync(versionFile) : "unknown\n");

  // 3. Encrypt into one file; remove the plain copy.
  if (!plain) {
    run("tar", ["-cf", archive, "-C", path.dirname(out), path.basename(out)], "tar");
    run("age", ["-r", recipient, "-o", `${archive}.age`, archive], "age");
    cleanupPlain();
    console.log(`wrote ${archive}.age`);
  } else {
    console.log(`wrote ${out} (NOT encrypted; local test only)`);
  }
} catch (err) {
  if (!plain) cleanupPlain();
  fs.rmSync(`${archive}.age`, { force: true });
  console.error(String(err.message ?? err));
  process.exit(1);
}
if (damaged > 0) {
  console.error(`${damaged} receipt problem(s); see manifest.csv in the archive`);
  process.exit(3);
}
