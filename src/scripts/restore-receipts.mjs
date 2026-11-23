// Put receipt files from a decrypted backup back into Storage, at the exact
// storage paths listed in manifest.csv (used by src/ops/bin/restore.sh).
// Usage: node src/scripts/restore-receipts.mjs <backup>/receipts
// Environment: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const dir = process.argv[2];
if (!dir) throw new Error("usage: restore-receipts.mjs <receipts dir>");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const rows = fs
  .readFileSync(path.join(dir, "manifest.csv"), "utf8")
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .map((line) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"')));

let ok = 0;
let missing = 0;
for (const [file, , , storagePath, sha] of rows) {
  if (file.startsWith("MISSING:")) {
    missing++;
    continue;
  }
  const bytes = fs.readFileSync(path.join(dir, file));
  const got = (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex");
  if (sha && got !== sha) console.error(`warning: ${file} does not match its recorded sha256`);
  const type = file.endsWith(".pdf") ? "application/pdf" : file.endsWith(".png") ? "image/png" : "image/jpeg";
  const { error } = await db.storage.from("receipts").upload(storagePath, new Blob([bytes], { type }), { upsert: true });
  if (error) throw new Error(`${file}: ${error.message}`);
  ok++;
}
console.log(`receipts restored: ${ok}, missing in backup: ${missing}`);
