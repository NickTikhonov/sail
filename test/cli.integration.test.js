const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const {
  getGraphRoot,
  initProject,
  runCli,
  writeNode,
  writeTest
} = require("./utils.js");

function functionNodeSource(id, body = '  return "ok";') {
  return `export default function ${id}() {\n${body}\n}\n`;
}

function constNodeSource(id, expression) {
  return `const ${id} = ${expression};\n\nexport default ${id};\n`;
}

function specSource(id) {
  return [
    'import { describe, expect, it } from "vitest";',
    `import ${id} from "./${id}";`,
    "",
    `describe("${id}", () => {`,
    '  it("returns a value", () => {',
    `    expect(${id}()).toBe("ok");`,
    "  });",
    "});",
    ""
  ].join("\n");
}

test("help explains config-driven graph roots and test commands", async (t) => {
  const { homeDir, projectRoot } = await initProject(t);
  const result = await runCli(projectRoot, ["help"], { homeDir });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /sail\.config\.json/);
  assert.match(result.stdout, /graphSrc/);
  assert.match(result.stdout, /sail test read\|write\|patch <id>/);
  assert.match(result.stdout, /<graphSrc>\/<id>\.ts/);
});

test("write without stdin fails with full-file guidance", async (t) => {
  const { homeDir, projectRoot } = await initProject(t);
  const result = await runCli(projectRoot, ["write", "greet"], {
    homeDir,
    stdin: ""
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /write requires replacement file contents on stdin/);
  assert.match(result.stderr, /pipe a full valid TypeScript file into the command/);
});

test("first function write succeeds, creates the node, and warns about missing tests", async (t) => {
  const { homeDir, projectRoot } = await initProject(t);
  const result = await writeNode(projectRoot, homeDir, "greet", functionNodeSource("greet"));
  const { graphRoot } = await getGraphRoot(projectRoot);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /created .*greet\.ts/);
  assert.match(result.stderr, /Node greet has estimated complexity 1 and no tests/);
  assert.match(result.stderr, /sail test write greet/);
  await fs.access(path.join(graphRoot, "greet.ts"));
});

test("open test debt blocks the next implementation write until tests are added", async (t) => {
  const { homeDir, projectRoot } = await initProject(t);

  const firstWrite = await writeNode(projectRoot, homeDir, "greet", functionNodeSource("greet"));
  assert.equal(firstWrite.code, 0);

  const blockedWrite = await writeNode(projectRoot, homeDir, "followUp", functionNodeSource("followUp"));
  assert.equal(blockedWrite.code, 1);
  assert.match(blockedWrite.stderr, /Cannot change implementation nodes while test debt is open/);
  assert.match(blockedWrite.stderr, /Outstanding node debt: greet \(0\/1\)/);

  const testWrite = await writeTest(projectRoot, homeDir, "greet", specSource("greet"));
  const { graphRoot } = await getGraphRoot(projectRoot);
  assert.equal(testWrite.code, 0);
  assert.match(testWrite.stdout, /created tests for greet/);
  await fs.access(path.join(graphRoot, "greet.spec.ts"));

  const unblockedWrite = await writeNode(
    projectRoot,
    homeDir,
    "followUp",
    functionNodeSource("followUp")
  );
  assert.equal(unblockedWrite.code, 0);
  assert.match(unblockedWrite.stdout, /created .*followUp\.ts/);
});

test("graph renders forward and reverse dependency chains for const nodes", async (t) => {
  const { homeDir, projectRoot } = await initProject(t);

  assert.equal((await writeNode(projectRoot, homeDir, "C", constNodeSource("C", '"c"'))).code, 0);
  assert.equal(
    (
      await writeNode(
        projectRoot,
        homeDir,
        "B",
        'import C from "./C";\n\nconst B = C + "b";\n\nexport default B;\n'
      )
    ).code,
    0
  );
  assert.equal(
    (
      await writeNode(
        projectRoot,
        homeDir,
        "A",
        'import B from "./B";\n\nconst A = B + "a";\n\nexport default A;\n'
      )
    ).code,
    0
  );

  const forward = await runCli(projectRoot, ["graph", "A", "--depth", "2"], { homeDir });
  const reverse = await runCli(projectRoot, ["graph", "C", "--reverse", "--depth", "2"], {
    homeDir
  });

  assert.equal(forward.code, 0);
  assert.equal(forward.stdout.trim(), "A\n  B\n    C");
  assert.equal(reverse.code, 0);
  assert.equal(reverse.stdout.trim(), "C\n  B\n    A");
});

test("named exports are rejected so each file keeps one public symbol", async (t) => {
  const { homeDir, projectRoot } = await initProject(t);
  const result = await writeNode(
    projectRoot,
    homeDir,
    "badNode",
    'export const extra = "nope";\nconst badNode = "ok";\n\nexport default badNode;\n'
  );

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Named variable exports are not allowed in badNode\.ts/);
});

test("top-level executable code outside index is rejected", async (t) => {
  const { homeDir, projectRoot } = await initProject(t);
  const result = await writeNode(
    projectRoot,
    homeDir,
    "badTopLevel",
    'console.log("nope");\n\nexport default function badTopLevel() {\n  return "ok";\n}\n'
  );

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Top-level executable statements are not allowed in badTopLevel\.ts/);
});

test("filename and exported symbol must match", async (t) => {
  const { homeDir, projectRoot } = await initProject(t);
  const result = await writeNode(
    projectRoot,
    homeDir,
    "wrongName",
    'export default function anotherName() {\n  return "ok";\n}\n'
  );

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Filename and exported symbol must match in wrongName\.ts/);
});
