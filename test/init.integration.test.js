const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const { createTempProject, readJson, runCli } = require("./utils.js");

test("init defaults graphSrc to src/sail when src already exists", async (t) => {
  const { homeDir, projectRoot } = await createTempProject(t);
  await fs.mkdir(path.join(projectRoot, "src"), { recursive: true });

  const result = await runCli(projectRoot, ["init"], { homeDir });
  assert.equal(result.code, 0);

  const config = await readJson(path.join(projectRoot, "sail.config.json"));
  assert.equal(config.graphSrc, "src/sail");

  const graphRoot = path.join(projectRoot, "src", "sail");
  const indexPath = path.join(graphRoot, "index.ts");
  const packageJson = await readJson(path.join(projectRoot, "package.json"));
  const tsconfig = await readJson(path.join(projectRoot, "tsconfig.json"));

  await fs.access(graphRoot);
  await fs.access(indexPath);
  assert.equal(packageJson.scripts.dev, "tsx src/sail/index.ts");
  assert.deepEqual(tsconfig.include, ["src/sail/**/*.ts"]);
});

test("init defaults graphSrc to sail when src does not exist", async (t) => {
  const { homeDir, projectRoot } = await createTempProject(t);

  const result = await runCli(projectRoot, ["init"], { homeDir });
  assert.equal(result.code, 0);

  const config = await readJson(path.join(projectRoot, "sail.config.json"));
  assert.equal(config.graphSrc, "sail");

  const graphRoot = path.join(projectRoot, "sail");
  const indexPath = path.join(graphRoot, "index.ts");
  const packageJson = await readJson(path.join(projectRoot, "package.json"));
  const tsconfig = await readJson(path.join(projectRoot, "tsconfig.json"));

  await fs.access(graphRoot);
  await fs.access(indexPath);
  assert.equal(packageJson.scripts.dev, "tsx sail/index.ts");
  assert.deepEqual(tsconfig.include, ["sail/**/*.ts"]);
});
