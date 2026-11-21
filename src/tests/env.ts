// Loads .env.local for integration tests that talk to the local Supabase stack.
import fs from "node:fs";

export function loadLocalEnv(): Record<string, string> {
  const text = fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf8") : "";
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    if (!line.includes("=") || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}
