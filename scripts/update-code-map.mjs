// Run: bun run notes:map   (optional: --seed <descriptions.mjs> for first-time text)
// Builds/refreshes the Obsidian "Code Map" notes (CLAUDE.md §17): one note per source file with
// Uses / Used by links worked out from the imports. Hand-written parts (Purpose, function
// descriptions, Notes) are kept from the existing note, so re-running never loses them.
// Only writes to the notes folder, never to the project.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const NOTES_DIR = process.env.CODE_MAP_DIR ?? "C:/Users/Moises/Desktop/MOISES/Digimall Notes";
const MAP_DIR = path.join(NOTES_DIR, "Code Map");
const today = new Date().toISOString().slice(0, 10);

const seedArg = process.argv.indexOf("--seed");
const seed = seedArg > 0 ? (await import(pathToFileURL(path.resolve(process.argv[seedArg + 1])).href)).default : {};

// ---------- which files get a note ----------
const SKIP = [/^public\//, /^suggestions\//, /\.md$/, /^bun\.lock$/, /^\.gitignore$/, /favicon\.ico$/];
const files = execSync("git ls-files", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((f) => !SKIP.some((re) => re.test(f)))
  .filter((f) => existsSync(f));
const fileSet = new Set(files);

// Note name: path without "src/", "/" -> " - ", brackets -> braces (Obsidian links break on "[ ]")
const noteName = (file) =>
  file.replace(/^src\//, "").split("/").join(" - ").replace(/\[/g, "{").replace(/\]/g, "}");
const link = (file) => `[[${noteName(file)}]]`;

// ---------- imports ----------
const CODE = /\.(ts|tsx|js|mjs)$/;
const IMPORT_RE = /(?:import|export)\s[^'";]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s+['"]([^'"]+)['"]/gm;

const resolveImport = (from, spec) => {
  let base;
  if (spec === "@payload-config") base = "src/payload.config";
  else if (spec.startsWith("@/")) base = "src/" + spec.slice(2);
  else if (spec.startsWith(".")) base = path.posix.join(path.posix.dirname(from), spec);
  else return { pkg: spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0] };
  const tries = [base, ...[".ts", ".tsx", ".js", ".mjs"].map((e) => base + e), base + "/index.ts", base + "/index.tsx"];
  const hit = tries.find((t) => fileSet.has(t));
  return hit ? { file: hit } : {};
};

const uses = new Map();
const pkgs = new Map();
const usedBy = new Map(files.map((f) => [f, new Set()]));
for (const f of files) {
  uses.set(f, new Set());
  pkgs.set(f, new Set());
  if (!CODE.test(f)) continue;
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2] ?? m[3];
    const r = resolveImport(f, spec);
    if (r.file && r.file !== f) {
      uses.get(f).add(r.file);
      usedBy.get(r.file).add(f);
    } else if (r.pkg && !r.pkg.startsWith("node:")) pkgs.get(f).add(r.pkg);
  }
}

// ---------- exports ----------
const exportsOf = (f) => {
  if (!CODE.test(f)) return [];
  const src = readFileSync(f, "utf8");
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:default\s+)?(?:async\s+)?(?:const|let|function|class|type|interface|enum)\s+([A-Za-z0-9_$]+)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s+default\s+([A-Za-z0-9_$]+)\s*;?\s*$/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s*\{([^}]+)\}/gm))
    m[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop()).filter(Boolean).forEach((n) => names.add(n));
  return [...names];
};

const KNOWN = {
  dynamic: "Tells Next.js to render this page on every request.",
  metadata: "Page title/description.",
  generateMetadata: "Builds the page title.",
};

// ---------- reading an existing note (keeps hand-written text) ----------
const sectionsOf = (text) => {
  const out = {};
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^## (.+)$/);
    if (h) { current = h[1].trim(); out[current] = []; continue; }
    if (current) out[current].push(line);
  }
  for (const k of Object.keys(out)) out[k] = out[k].join("\n").trim();
  return out;
};

// payload-types.ts is generated: every export is a document type or its "Select" field picker
const generated = (f, n) =>
  f === "src/payload-types.ts" ? (n.endsWith("Select") ? "Field-picker type (generated)." : "Document/config type (generated).") : "";

const isUi = (f) => f.startsWith("src/components/ui/");
const uiName = (f) => path.basename(f).replace(/\.tsx?$/, "");

const buildNote = (f, old) => {
  const prev = old ? sectionsOf(old) : {};
  const s = seed[f] ?? {};
  const oldFns = {};
  for (const line of (prev["Main functions/classes"] ?? "").split("\n")) {
    const m = line.match(/^- `([^`]+)` — (.*)$/);
    if (m) oldFns[m[1]] = m[2];
  }
  const keep = (v) => (v && !v.startsWith("TODO") ? v : "");
  const purpose =
    keep(prev["Purpose"]) || s.p || (isUi(f) ? `shadcn/ui building block (${uiName(f)}). Generated by shadcn; only restyle, don't add business logic here.` : "TODO: describe this file.");
  const notes = keep(prev["Notes"]) || s.n || (isUi(f) ? "Generated by shadcn/ui." : "—");

  const names = exportsOf(f);
  // Hand-described non-exported functions stay listed while the name still appears in the file
  const source = CODE.test(f) ? readFileSync(f, "utf8") : "";
  for (const n of [...Object.keys(s.f ?? {}), ...Object.keys(oldFns)])
    if (!names.includes(n) && (s.f?.[n] || source.includes(n))) names.push(n);
  const fnLines = names.map((n) => `- \`${n}\` — ${keep(oldFns[n]) || s.f?.[n] || KNOWN[n] || generated(f, n) || (isUi(f) ? "UI piece." : "TODO: describe.")}`);

  const u = [...uses.get(f)].sort().map((x) => `- ${link(x)}`);
  const p = [...pkgs.get(f)].sort().map((x) => `\`${x}\``);
  const b = [...usedBy.get(f)].sort().map((x) => `- ${link(x)}`);

  return [
    `# ${f.replace(/^src\//, "")}`,
    "",
    `Path: \`${f}\` · back to [[_Index]]`,
    "",
    "## Purpose",
    purpose,
    "",
    "## Main functions/classes",
    fnLines.length ? fnLines.join("\n") : CODE.test(f) ? "_No exports (runs on its own)._" : "_Not code (config/data file)._",
    "",
    "## Uses",
    [u.join("\n"), p.length ? `Packages: ${p.join(", ")}` : ""].filter(Boolean).join("\n\n") || "_Nothing inside the project._",
    "",
    "## Used by",
    b.length ? b.join("\n") : "_Nothing imports it (entry point, config, or loaded by Next.js/Payload)._",
    "",
    "## Notes",
    notes,
    "",
  ].join("\n");
};

// ---------- write ----------
mkdirSync(MAP_DIR, { recursive: true });
mkdirSync(path.join(NOTES_DIR, "Claude Logs"), { recursive: true });
let created = 0;
let updated = 0;
for (const f of files) {
  const target = path.join(MAP_DIR, noteName(f) + ".md");
  const old = existsSync(target) ? readFileSync(target, "utf8") : null;
  const next = buildNote(f, old);
  if (old === next) continue;
  writeFileSync(target, next);
  if (old) updated++;
  else created++;
}

// Notes whose file is gone: mark them, never delete them
const live = new Set(files.map((f) => noteName(f) + ".md"));
let deleted = 0;
for (const name of readdirSync(MAP_DIR)) {
  if (!name.endsWith(".md") || name === "_Index.md" || live.has(name)) continue;
  const p = path.join(MAP_DIR, name);
  const text = readFileSync(p, "utf8");
  if (text.startsWith("**DELETED")) continue;
  writeFileSync(p, `**DELETED (${today})**\n\n${text}`);
  deleted++;
}

// Keep the file list in _Index.md current (between the markers; the rest is hand-written)
const indexPath = path.join(MAP_DIR, "_Index.md");
if (existsSync(indexPath)) {
  const groups = new Map();
  for (const f of files) {
    const dir = f.includes("/") ? f.split("/").slice(0, f.startsWith("src/") ? 2 : 1).join("/") : "(project root)";
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(f);
  }
  const list = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, fs]) => `### ${dir}\n${fs.map((f) => `- ${link(f)}`).join("\n")}`)
    .join("\n\n");
  const index = readFileSync(indexPath, "utf8");
  const START = "<!-- file-list:start -->";
  const END = "<!-- file-list:end -->";
  if (index.includes(START) && index.includes(END)) {
    const nextIndex = index.slice(0, index.indexOf(START) + START.length) + "\n" + list + "\n" + index.slice(index.indexOf(END));
    if (nextIndex !== index) writeFileSync(indexPath, nextIndex);
  }
}

const todo = files.filter((f) => readFileSync(path.join(MAP_DIR, noteName(f) + ".md"), "utf8").includes("TODO"));
console.log(`Code Map: ${files.length} files · ${created} new · ${updated} updated · ${deleted} marked deleted`);
if (todo.length) console.log(`Still has TODO text:\n  ${todo.join("\n  ")}`);
