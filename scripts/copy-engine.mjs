// Copies the single-threaded lite Stockfish build into public/ so the browser
// can load it as a Web Worker. It needs no cross-origin isolation headers.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve("stockfish/package.json"));
const { buildVersion } = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const base = `stockfish-${buildVersion}-lite-single`;
const outDir = join(import.meta.dirname, "..", "public", "engine");

mkdirSync(outDir, { recursive: true });
copyFileSync(join(pkgDir, "bin", `${base}.js`), join(outDir, "stockfish.js"));
copyFileSync(join(pkgDir, "bin", `${base}.wasm`), join(outDir, "stockfish.wasm"));
console.log(`Copied ${base} to public/engine`);
