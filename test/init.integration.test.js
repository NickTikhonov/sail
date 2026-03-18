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
  assert.deepEqual(tsconfig.include, ["src/sail/**/*.ts", "src/sail/**/*.tsx"]);
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
  assert.deepEqual(tsconfig.include, ["sail/**/*.ts", "sail/**/*.tsx"]);
});

test("init with a project name creates and initializes that directory", async (t) => {
  const { homeDir, projectRoot } = await createTempProject(t);

  const result = await runCli(projectRoot, ["init", "my-app"], { homeDir });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /initialized project in my-app:/);

  const childRoot = path.join(projectRoot, "my-app");
  const config = await readJson(path.join(childRoot, "sail.config.json"));
  const packageJson = await readJson(path.join(childRoot, "package.json"));
  const tsconfig = await readJson(path.join(childRoot, "tsconfig.json"));

  assert.equal(config.graphSrc, "sail");
  await fs.access(path.join(childRoot, "sail", "index.ts"));
  assert.equal(packageJson.scripts.dev, "tsx sail/index.ts");
  assert.deepEqual(tsconfig.include, ["sail/**/*.ts", "sail/**/*.tsx"]);
});

test("init prepends sail guidance into an existing CLAUDE.md in the current directory", async (t) => {
  const { homeDir, projectRoot } = await createTempProject(t);
  const existingClaude = [
    "# Existing Notes",
    "",
    "- keep the current deploy flow",
    "- prefer small PRs",
    ""
  ].join("\n");

  await fs.writeFile(path.join(projectRoot, "CLAUDE.md"), existingClaude, "utf8");

  const result = await runCli(projectRoot, ["init"], { homeDir });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /prepended sail guidance to the existing CLAUDE\.md/i);
  assert.match(result.stdout, /review that file and tailor the merged instructions/i);

  const mergedClaude = await fs.readFile(path.join(projectRoot, "CLAUDE.md"), "utf8");
  assert.match(mergedClaude, /^Use sail for all work in this repo\./);
  assert.match(mergedClaude, /1\. Do not manually read or write files under `sail\/`\./);
  assert.match(mergedClaude, /# Existing Notes/);
  assert.match(mergedClaude, /- keep the current deploy flow/);
});
