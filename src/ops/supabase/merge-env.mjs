// Merge KEY=VALUE lines from a settings file into a .env file: existing keys
// are replaced in place, new keys are appended. Never prints values.
// Usage: node merge-env.mjs <target .env> <settings file>
import fs from "node:fs";

const [target, source] = process.argv.slice(2);
if (!target || !source) throw new Error("usage: merge-env.mjs <target> <source>");

const parse = (text) =>
  text
    .split("\n")
    .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]);

const settings = new Map(parse(fs.readFileSync(source, "utf8")));
const lines = fs.readFileSync(target, "utf8").split("\n");
const seen = new Set();
const out = lines.map((line) => {
  const m = /^([A-Z0-9_]+)=/.exec(line);
  if (!m || !settings.has(m[1])) return line;
  seen.add(m[1]);
  // Replace always: an empty setting clears the example placeholder
  // (e.g. SMTP_PASS=fake_mail_password) so start.sh notices it is unset.
  return `${m[1]}=${settings.get(m[1])}`;
});
const added = [...settings].filter(([k]) => !seen.has(k)).map(([k, v]) => `${k}=${v}`);
fs.writeFileSync(target, [...out, ...(added.length ? ["", "# church settings", ...added] : [])].join("\n"), { mode: 0o600 });
console.log(`merged ${settings.size} settings (${added.length} new) into ${target}`);
