import { cp, mkdir } from "node:fs/promises";
import * as esbuild from "esbuild";

await mkdir(new URL("./dist/", import.meta.url), { recursive: true });

await esbuild.build({
  entryPoints: ["extension/src/content.js"],
  bundle: true,
  outfile: "extension/dist/content.js",
  format: "iife",
  target: "chrome120",
  legalComments: "none",
});

await esbuild.build({
  entryPoints: ["extension/src/page-bridge.js"],
  bundle: true,
  outfile: "extension/dist/page-bridge.js",
  format: "iife",
  target: "chrome120",
  legalComments: "none",
});

await esbuild.build({
  entryPoints: ["extension/src/background.js"],
  bundle: true,
  outfile: "extension/dist/background.js",
  format: "esm",
  target: "chrome120",
  legalComments: "none",
});

await cp(new URL("./manifest.json", import.meta.url), new URL("./dist/manifest.json", import.meta.url));
await cp(new URL("./popup.html", import.meta.url), new URL("./dist/popup.html", import.meta.url));
await cp(new URL("./popup.css", import.meta.url), new URL("./dist/popup.css", import.meta.url));
await cp(new URL("./popup.js", import.meta.url), new URL("./dist/popup.js", import.meta.url));
