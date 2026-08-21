import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pngPath = path.join(root, "src-tauri", "icons", "icon.png");
const png = fs.readFileSync(pngPath);
const b64 = png.toString("base64");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="BassOrder">
  <image href="data:image/png;base64,${b64}" width="512" height="512"/>
</svg>
`;

const targets = [
  path.join(root, "deploy", "landing"),
  path.join(root, "public"),
];

for (const dir of targets) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "logo.svg"), svg);
  fs.copyFileSync(pngPath, path.join(dir, "favicon.png"));
  fs.copyFileSync(
    path.join(root, "src-tauri", "icons", "icon.ico"),
    path.join(dir, "favicon.ico"),
  );
  fs.copyFileSync(
    path.join(root, "src-tauri", "icons", "128x128.png"),
    path.join(dir, "apple-touch-icon.png"),
  );
  // Fallback OG until a dedicated 1200x630 is available.
  fs.copyFileSync(pngPath, path.join(dir, "og-image.png"));
}

console.log("SEO brand assets written to deploy/landing and public");
