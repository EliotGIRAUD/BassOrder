import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logoSvg = path.join(root, "assets", "logo.svg");
const iconPng = path.join(root, "src-tauri", "icons", "icon.png");
const iconIco = path.join(root, "src-tauri", "icons", "icon.ico");
const appleSrc = path.join(root, "src-tauri", "icons", "128x128.png");

if (!fs.existsSync(logoSvg)) {
  throw new Error(`Missing ${logoSvg}`);
}
if (!fs.existsSync(iconPng)) {
  throw new Error(`Missing ${iconPng} — run: pnpm tauri icon assets/logo.svg`);
}

const targets = [
  path.join(root, "deploy", "landing"),
  path.join(root, "public"),
];

for (const dir of targets) {
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(logoSvg, path.join(dir, "logo.svg"));
  fs.copyFileSync(iconPng, path.join(dir, "favicon.png"));
  fs.copyFileSync(iconIco, path.join(dir, "favicon.ico"));
  fs.copyFileSync(appleSrc, path.join(dir, "apple-touch-icon.png"));
  // Fallback OG until a dedicated 1200x630 is available.
  fs.copyFileSync(iconPng, path.join(dir, "og-image.png"));
}

fs.copyFileSync(iconPng, path.join(root, "assets", "logo.png"));

console.log("SEO brand assets written to deploy/landing, public, and assets/logo.png");
