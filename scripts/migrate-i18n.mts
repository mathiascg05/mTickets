/**
 * One-shot migration: converts the flat `translations` object in
 * src/lib/i18n.ts into nested JSON files at src/messages/{es,en}.json
 * for next-intl.
 *
 * Run with: pnpm tsx scripts/migrate-i18n.mts
 */
import { writeFileSync, mkdirSync } from "fs";

type Nested = { [k: string]: string | Nested };

const mod = await import("../src/lib/i18n.ts");
const translations = mod.translations as Record<string, Record<"es" | "en", string>>;

const es: Nested = {};
const en: Nested = {};

const conflicts: string[] = [];

function setNested(root: Nested, flatKey: string, value: string) {
  const parts = flatKey.split(".");
  let cur: Nested = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const next = cur[part];
    if (typeof next === "string") {
      conflicts.push(`${flatKey} conflicts with leaf at ${parts.slice(0, i + 1).join(".")}`);
      // Replace string with object to allow nesting (we keep the conflict log)
      cur[part] = {};
    } else if (next === undefined) {
      cur[part] = {};
    }
    cur = cur[part] as Nested;
  }
  const last = parts[parts.length - 1];
  if (typeof cur[last] === "object") {
    conflicts.push(`${flatKey} conflicts with existing object`);
  }
  cur[last] = value;
}

for (const [flatKey, entry] of Object.entries(translations)) {
  setNested(es, flatKey, entry.es);
  setNested(en, flatKey, entry.en);
}

mkdirSync("src/messages", { recursive: true });
writeFileSync("src/messages/es.json", JSON.stringify(es, null, 2) + "\n");
writeFileSync("src/messages/en.json", JSON.stringify(en, null, 2) + "\n");

console.log(`Wrote src/messages/es.json (${Object.keys(translations).length} keys)`);
console.log(`Wrote src/messages/en.json`);
if (conflicts.length > 0) {
  console.warn(`\nConflicts encountered (${conflicts.length}):`);
  for (const c of conflicts) console.warn(`  - ${c}`);
}
