import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: false,
  entry: ["src/cli.ts"],
  format: ["cjs"],
  outExtension() {
    return {
      js: ".js"
    };
  },
  outDir: "dist",
  shims: false,
  sourcemap: true,
  target: "node20",
  banner: {
    js: "#!/usr/bin/env node"
  }
});
