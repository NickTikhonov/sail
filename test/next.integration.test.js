const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const {
  createNextStyleProject,
  readJson,
  runCli,
  writeNode
} = require("./utils.js");

function constNodeSource(id, expression) {
  return `const ${id} = ${expression};\n\nexport default ${id};\n`;
}

test("init works inside an existing Next-style TypeScript project and enforces the public index boundary", async (t) => {
  const { homeDir, projectRoot } = await createNextStyleProject(t);

  const initResult = await runCli(projectRoot, ["init"], { homeDir });
  assert.equal(initResult.code, 0);
  assert.match(initResult.stdout, /package\.json \(kept existing\)/);
  assert.match(initResult.stdout, /tsconfig\.json \(merged\)/);

  const config = await readJson(path.join(projectRoot, "sail.config.json"));
  assert.equal(config.graphSrc, "sail");

  const packageJson = await readJson(path.join(projectRoot, "package.json"));
  assert.equal(packageJson.name, "next-style-project");

  const tsconfig = await readJson(path.join(projectRoot, "tsconfig.json"));
  assert.deepEqual(tsconfig.include, [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    "sail/**/*.ts",
    "sail/**/*.tsx"
  ]);

  const indexPath = path.join(projectRoot, "sail", "index.ts");
  const indexSource = await fs.readFile(indexPath, "utf8");
  assert.match(indexSource, /export \{\};/);

  assert.equal((await writeNode(projectRoot, homeDir, "Greeting", constNodeSource("Greeting", '"hello"'))).code, 0);
  assert.equal((await writeNode(projectRoot, homeDir, "Accent", constNodeSource("Accent", '"!"'))).code, 0);

  await fs.writeFile(
    path.join(projectRoot, "app", "page.tsx"),
    [
      'import Greeting from "../sail/Greeting";',
      "",
      "export default function Page() {",
      "  return <main>{Greeting}</main>;",
      "}",
      ""
    ].join("\n"),
    "utf8"
  );

  const blockedWrite = await writeNode(projectRoot, homeDir, "Color", constNodeSource("Color", '"blue"'));
  assert.equal(blockedWrite.code, 1);
  assert.match(blockedWrite.stderr, /import-boundary debt is open/i);
  assert.match(blockedWrite.stderr, /app\/page\.tsx -> sail\/Greeting\.ts/);
  assert.match(blockedWrite.stderr, /re-export the needed node from `sail\/index\.ts`/i);

  const indexWrite = await runCli(projectRoot, ["write", "index"], {
    homeDir,
    stdin: 'export { default as Greeting } from "./Greeting";\n'
  });
  assert.equal(indexWrite.code, 0);
  assert.match(indexWrite.stderr, /Architecture debt is open/i);

  await fs.writeFile(
    path.join(projectRoot, "app", "page.tsx"),
    'export { Greeting as default } from "../sail/index";\n',
    "utf8"
  );

  const unblockedWrite = await writeNode(projectRoot, homeDir, "Color", constNodeSource("Color", '"blue"'));
  assert.equal(unblockedWrite.code, 0);
});

test("Next adapter debt blocks later sail writes until every adapter is cleaned up", async (t) => {
  const { homeDir, projectRoot } = await createNextStyleProject(t);

  const initResult = await runCli(projectRoot, ["init"], { homeDir });
  assert.equal(initResult.code, 0);

  assert.equal(
    (await writeNode(projectRoot, homeDir, "ChessPage", constNodeSource("ChessPage", '"chess"'))).code,
    0
  );
  assert.equal(
    (await writeNode(projectRoot, homeDir, "RootLayout", constNodeSource("RootLayout", '"layout"'))).code,
    0
  );

  const indexWrite = await runCli(projectRoot, ["write", "index"], {
    homeDir,
    stdin: [
      'export { default as ChessPage } from "./ChessPage";',
      'export { default as RootLayout } from "./RootLayout";',
      ""
    ].join("\n")
  });
  assert.equal(indexWrite.code, 0);

  await fs.writeFile(
    path.join(projectRoot, "app", "page.tsx"),
    [
      'import { ChessPage } from "../sail/index";',
      "",
      "export default function Page() {",
      "  return <main>{ChessPage}</main>;",
      "}",
      ""
    ].join("\n"),
    "utf8"
  );

  await fs.writeFile(
    path.join(projectRoot, "app", "layout.tsx"),
    [
      'import { RootLayout } from "../sail/index";',
      "",
      "export default function Layout({ children }) {",
      "  return <body>{RootLayout}{children}</body>;",
      "}",
      ""
    ].join("\n"),
    "utf8"
  );

  const blockedWrite = await writeNode(projectRoot, homeDir, "AfterDebt", constNodeSource("AfterDebt", '"later"'));
  assert.equal(blockedWrite.code, 1);
  assert.match(blockedWrite.stderr, /Next adapter debt is open/i);
  assert.match(blockedWrite.stderr, /app\/layout\.tsx/);
  assert.match(blockedWrite.stderr, /app\/page\.tsx/);

  await fs.writeFile(
    path.join(projectRoot, "app", "page.tsx"),
    'export { ChessPage as default } from "../sail/index";\n',
    "utf8"
  );

  const stillBlockedWrite = await writeNode(
    projectRoot,
    homeDir,
    "StillBlocked",
    constNodeSource("StillBlocked", '"still"')
  );
  assert.equal(stillBlockedWrite.code, 1);
  assert.match(stillBlockedWrite.stderr, /app\/layout\.tsx/);
  assert.doesNotMatch(stillBlockedWrite.stderr, /app\/page\.tsx/);

  await fs.writeFile(
    path.join(projectRoot, "app", "layout.tsx"),
    'export { RootLayout as default } from "../sail/index";\n',
    "utf8"
  );

  const unblockedWrite = await writeNode(
    projectRoot,
    homeDir,
    "AfterCleanup",
    constNodeSource("AfterCleanup", '"done"')
  );
  assert.equal(unblockedWrite.code, 0);
});
