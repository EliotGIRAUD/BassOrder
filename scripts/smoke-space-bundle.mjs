import fs from "fs";
import path from "path";

const assets = path.join("dist", "assets");
if (!fs.existsSync(assets)) {
  console.error("FAIL dist/assets missing — run pnpm build first");
  process.exit(1);
}

const jsName = fs.readdirSync(assets).find((f) => /^index-.*\.js$/.test(f));
const cssName = fs.readdirSync(assets).find((f) => /^index-.*\.css$/.test(f));
if (!jsName || !cssName) {
  console.error("FAIL index assets not found in dist/assets");
  process.exit(1);
}

const js = fs.readFileSync(path.join(assets, jsName), "utf8");
const css = fs.readFileSync(path.join(assets, cssName), "utf8");

const checks = [
  ["Mon espace", js.includes("Mon espace")],
  ["search recent key", js.includes("bassorder.search.recent.v1")],
  ["knowledge guide key", js.includes("bassorder.knowledgeGuide.v1")],
  ["rail-update", js.includes("rail-update")],
  ["history-stats--compact CSS", css.includes("history-stats--compact")],
  ["history-older CSS", css.includes("history-older")],
  ["settings-advanced CSS", css.includes("settings-advanced")],
  ["settings-orbital CSS", css.includes("settings-orbital")],
  ["profile-identity-hint CSS", css.includes("profile-identity-hint")],
  ["identity hint FR", js.includes("sur cette machine")],
  ["orbital FR", js.includes("Terrain orbital")],
  ["orbital EN", js.includes("Orbital playground")],
];

let failed = 0;
for (const [label, ok] of checks) {
  console.log(ok ? "OK  " : "FAIL", label);
  if (!ok) failed++;
}

process.exit(failed ? 1 : 0);
