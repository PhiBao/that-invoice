// Builds both contracts to wasm and shrinks them with wasm-opt (binaryen).
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { root, sha256, b58 } from "./lib.mjs";

const wasmOpt = process.env.WASM_OPT ?? (fs.existsSync(path.join(os.homedir(), ".local/opt/binaryen-version_133/bin/wasm-opt"))
  ? path.join(os.homedir(), ".local/opt/binaryen-version_133/bin/wasm-opt") : "wasm-opt");
const out = path.join(root, "target", "wasm");
fs.mkdirSync(out, { recursive: true });
execSync("cargo build --release --target wasm32-unknown-unknown -p registry -p invoice-account", { cwd: root, stdio: "inherit" });
for (const name of ["registry", "invoice_account"]) {
  const src = path.join(root, "target/wasm32-unknown-unknown/release", `${name}.wasm`);
  const dst = path.join(out, `${name}.wasm`);
  execSync(`${wasmOpt} -Oz --enable-bulk-memory --enable-sign-ext --enable-nontrapping-float-to-int --strip-debug --strip-producers ${src} -o ${dst}`, { stdio: "inherit" });
  const buf = fs.readFileSync(dst);
  console.log(`${name}: ${buf.length} bytes  code_hash=${b58(sha256(buf))}`);
}
