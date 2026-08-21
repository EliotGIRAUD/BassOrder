import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = resolve(root, "server/Cargo.toml");
if (!existsSync(manifest)) {
  console.error("server/Cargo.toml introuvable");
  process.exit(1);
}

// Charge server/.env via dotenvy côté Rust. Pour le dév sans .env :
if (!process.env.BASSORDER_JWT_SECRET && !process.env.BASSORDER_ALLOW_INSECURE_DEV) {
  process.env.BASSORDER_ALLOW_INSECURE_DEV = "1";
}

const release = process.argv.includes("--release");
const args = ["run", "--manifest-path", "server/Cargo.toml"];
if (release) args.splice(1, 0, "--release");

const child = spawn("cargo", args, {
  stdio: "inherit",
  shell: true,
  env: process.env,
  cwd: root,
});

child.on("exit", (code) => process.exit(code ?? 1));
