import fs from "node:fs/promises";
import path from "node:path";
import { applyPatch, parsePatch } from "diff";
import SailError from "./SailError.js";
import analyzeTestDebt, { type TestDebtEntry } from "./analyzeTestDebt.js";
import analyzeFunctionComplexity from "./analyzeFunctionComplexity.js";
import buildProjectState from "./buildProjectState.js";
import buildTestState from "./buildTestState.js";
import countSpecTests from "./countSpecTests.js";
import initProject from "./initProject.js";
import runTargetSpec from "./runTargetSpec.js";
import { getSpecPath, readSpecFile } from "./testFiles.js";

type ProjectState = Awaited<ReturnType<typeof buildProjectState>>;
type GraphNode = ProjectState["nodes"] extends Map<string, infer NodeType> ? NodeType : never;

type CommandInput =
  | {
      command: "init";
      force: boolean;
      projectRoot: string;
    }
  | {
      command: "graph";
      depth: number;
      id?: string;
      projectRoot: string;
      reverse: boolean;
    }
  | {
      command: "patch";
      diff: boolean;
      find?: string;
      id: string;
      projectRoot: string;
      replace?: string;
      stdin: string;
    }
  | {
      command: "query";
      exact: boolean;
      projectRoot: string;
      term: string;
    }
  | {
      command: "read";
      depth: number;
      id: string;
      projectRoot: string;
      revdepth: number;
    }
  | {
      command: "write";
      id: string;
      projectRoot: string;
      stdin: string;
    }
  | {
      command: "test-read";
      id: string;
      projectRoot: string;
    }
  | {
      command: "test-write";
      id: string;
      projectRoot: string;
      stdin: string;
    }
  | {
      command: "test-patch";
      diff: boolean;
      find?: string;
      id: string;
      projectRoot: string;
      replace?: string;
      stdin: string;
    };

type QualitySummary = {
  complexity?: number;
  debtCount?: number;
  debtNodes?: TestDebtEntry[];
  failedTests?: number;
  nodeId?: string;
  passedTests?: number;
  recommendedTests?: number;
  specStatus?: "failed" | "missing" | "passed" | "unavailable";
  testsFound?: number;
  totalTests?: number;
};

type CommandResult = {
  quality?: QualitySummary;
  projectState: ProjectState;
  shouldWriteSnapshot: boolean;
  stderr: string;
  stdout: string;
  touchedNodes: string[];
};

function getNodeOrThrow(projectState: ProjectState, id: string): GraphNode {
  const resolvedId = id === "main" ? "index" : id;
  const node = projectState.nodes.get(resolvedId);
  if (!node) {
    throw new SailError(
      `Could not find node ${id}.\n` +
        `What to do: run \`sail query ${id}\` to find similar node ids, or create \`${path.join(projectState.graphSrc, `${resolvedId}.ts`)}\` as a valid node file.`
    );
  }

  return node;
}

function collectReachableIds(
  projectState: ProjectState,
  startId: string,
  depth: number,
  edgeSelector: (node: GraphNode) => string[]
): string[] {
  if (depth <= 0) {
    return [];
  }

  const results: string[] = [];
  const visited = new Set<string>([startId]);
  const queue: Array<{ depth: number; id: string }> = [{ depth: 0, id: startId }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    if (current.depth >= depth) {
      continue;
    }

    const node = getNodeOrThrow(projectState, current.id);
    for (const nextId of edgeSelector(node)) {
      if (visited.has(nextId)) {
        continue;
      }

      visited.add(nextId);
      results.push(nextId);
      queue.push({
        depth: current.depth + 1,
        id: nextId
      });
    }
  }

  return results;
}

function renderFiles(nodes: GraphNode[]): string {
  return nodes
    .map((node) => `// ${node.pathFromRoot}\n${node.source.trimEnd()}`)
    .join("\n\n");
}

function renderRawFile(pathFromRoot: string, source: string): string {
  return `// ${pathFromRoot}\n${source.trimEnd()}`;
}

function formatDebtEntry(entry: TestDebtEntry): string {
  return `${entry.nodeId} (${entry.testsFound}/${entry.recommendedTests})`;
}

function renderDebtWarnings(debtEntries: TestDebtEntry[]): string[] {
  if (debtEntries.length === 0) {
    return [];
  }

  const lines = [
    `WARNING: Test debt is open for ${debtEntries.length} node${debtEntries.length === 1 ? "" : "s"}.`
  ];

  debtEntries.slice(0, 5).forEach((entry) => {
    lines.push(
      `WARNING: Node ${entry.nodeId} has ${entry.testsFound} test${entry.testsFound === 1 ? "" : "s"}; ` +
        `recommended rough minimum is ${entry.recommendedTests}.`
    );
  });

  if (debtEntries.length > 5) {
    lines.push(`WARNING: ${debtEntries.length - 5} more node debts are still open.`);
  }

  const firstNodeId = debtEntries[0]?.nodeId;
  if (firstNodeId) {
    lines.push(
      `WARNING: Next step: pay back test debt with \`sail test write ${firstNodeId}\` or \`sail test patch ${firstNodeId}\`.`
    );
  }

  return lines;
}

async function assertNoOutstandingTestDebt(projectRoot: string): Promise<void> {
  const projectState = await buildProjectState(projectRoot, { validateTypes: false });
  const debtEntries = await analyzeTestDebt(projectRoot, projectState);
  if (debtEntries.length === 0) {
    return;
  }

  const summary = debtEntries.slice(0, 5).map(formatDebtEntry).join(", ");
  throw new SailError(
    `Cannot change implementation nodes while test debt is open.\n` +
      `Outstanding node debt: ${summary}${debtEntries.length > 5 ? ", ..." : ""}.\n` +
      `What to do: write or patch tests for the outstanding nodes first using \`sail test write <id>\` or \`sail test patch <id>\`.`
  );
}

function renderGraph(
  projectState: ProjectState,
  startId: string,
  depth: number,
  reverse: boolean
): string {
  const expanded = new Set<string>();
  const getNextIds = (id: string): string[] => {
    const node = getNodeOrThrow(projectState, id);
    return reverse ? node.importedBy : node.imports;
  };

  const visit = (id: string, currentDepth: number, active: Set<string>): string[] => {
    const prefix = "  ".repeat(currentDepth);
    const alreadyExpanded = expanded.has(id);
    const nextIds = getNextIds(id);
    const shouldCollapse = alreadyExpanded && currentDepth < depth && nextIds.length > 0;
    const line = `${prefix}${id}${shouldCollapse ? "..." : ""}`;
    if (alreadyExpanded) {
      return [line];
    }

    expanded.add(id);
    if (currentDepth >= depth) {
      return [line];
    }
    if (nextIds.length === 0) {
      return [line];
    }

    const lines = [line];
    for (const nextId of nextIds) {
      if (active.has(nextId)) {
        lines.push(`${"  ".repeat(currentDepth + 1)}${nextId} (cycle)`);
        continue;
      }

      const nextActive = new Set(active);
      nextActive.add(nextId);
      lines.push(...visit(nextId, currentDepth + 1, nextActive));
    }

    return lines;
  };

  return visit(startId, 0, new Set([startId])).join("\n");
}

function renderFullGraph(projectState: ProjectState, depth: number, reverse: boolean): string {
  const allNodes = [...projectState.nodes.values()].sort((left, right) => left.id.localeCompare(right.id));
  const rootNodes = allNodes.filter((node) =>
    reverse ? node.imports.length === 0 : node.importedBy.length === 0
  );
  const orderedRoots =
    rootNodes.length > 0
      ? rootNodes.map((node) => node.id)
      : allNodes.map((node) => node.id);
  const renderedSections = new Set<string>();
  const sections: string[] = [];

  const collectIds = (startId: string): string[] => {
    const lines: string[] = [];
    const expanded = new Set<string>();
    const getNextIds = (id: string): string[] => {
      const node = getNodeOrThrow(projectState, id);
      return reverse ? node.importedBy : node.imports;
    };

    const visit = (id: string, currentDepth: number, active: Set<string>): void => {
      const prefix = "  ".repeat(currentDepth);
      const alreadyExpanded = expanded.has(id);
      const nextIds = getNextIds(id);
      const shouldCollapse = alreadyExpanded && currentDepth < depth && nextIds.length > 0;
      lines.push(`${prefix}${id}${shouldCollapse ? "..." : ""}`);
      if (alreadyExpanded) {
        return;
      }

      expanded.add(id);

      if (currentDepth >= depth) {
        return;
      }
      for (const nextId of nextIds) {
        if (active.has(nextId)) {
          lines.push(`${"  ".repeat(currentDepth + 1)}${nextId} (cycle)`);
          continue;
        }

        const nextActive = new Set(active);
        nextActive.add(nextId);
        visit(nextId, currentDepth + 1, nextActive);
      }
    };

    visit(startId, 0, new Set([startId]));
    return lines;
  };

  for (const rootId of orderedRoots) {
    if (renderedSections.has(rootId)) {
      continue;
    }

    sections.push(collectIds(rootId).join("\n"));
    renderedSections.add(rootId);
  }

  return sections.join("\n\n");
}

async function runRead(input: Extract<CommandInput, { command: "read" }>): Promise<CommandResult> {
  const projectState = await buildProjectState(input.projectRoot, { validateTypes: false });
  const node = getNodeOrThrow(projectState, input.id);
  const forwardIds = collectReachableIds(projectState, node.id, input.depth, (current) => current.imports);
  const reverseIds = collectReachableIds(projectState, node.id, input.revdepth, (current) => current.importedBy);
  const orderedIds = [node.id, ...forwardIds, ...reverseIds].filter(
    (id, index, values) => values.indexOf(id) === index
  );

  return {
    projectState,
    shouldWriteSnapshot: false,
    stderr: "",
    stdout: renderFiles(orderedIds.map((id) => getNodeOrThrow(projectState, id))),
    touchedNodes: orderedIds
  };
}

async function runQuery(input: Extract<CommandInput, { command: "query" }>): Promise<CommandResult> {
  const projectState = await buildProjectState(input.projectRoot, { validateTypes: false });
  const searchTerm = input.term.toLowerCase();
  const results = [...projectState.nodes.values()].filter((node) => {
    if (input.exact) {
      return node.id === input.term;
    }

    return (
      node.id.toLowerCase().includes(searchTerm) ||
      node.pathFromRoot.toLowerCase().includes(searchTerm) ||
      node.source.toLowerCase().includes(searchTerm)
    );
  });

  return {
    projectState,
    shouldWriteSnapshot: false,
    stderr: "",
    stdout: results.map((node) => `${node.id} ${node.kind} ${node.pathFromRoot}`).join("\n"),
    touchedNodes: results.map((node) => node.id)
  };
}

async function runGraph(input: Extract<CommandInput, { command: "graph" }>): Promise<CommandResult> {
  const projectState = await buildProjectState(input.projectRoot, { validateTypes: false });
  if (!input.id) {
    const touchedNodes = [...projectState.nodes.keys()].sort();

    return {
      projectState,
      shouldWriteSnapshot: false,
      stderr: "",
      stdout: renderFullGraph(projectState, input.depth, input.reverse),
      touchedNodes
    };
  }

  const node = getNodeOrThrow(projectState, input.id);

  return {
    projectState,
    shouldWriteSnapshot: false,
    stderr: "",
    stdout: renderGraph(projectState, node.id, input.depth, input.reverse),
    touchedNodes: [node.id]
  };
}

function applyExactPatch(source: string, find: string, replace: string, readHint: string): string {
  const matchCount = source.split(find).length - 1;
  if (matchCount === 0) {
    throw new SailError(
      `patch could not find the requested text.\n` +
        `What to do: run \`${readHint}\`, copy the exact text including whitespace, and retry.`
    );
  }

  if (matchCount > 1) {
    throw new SailError(
      `patch matched the requested text more than once.\n` +
        `What to do: provide a more specific \`--find\` string so exactly one replacement is applied.`
    );
  }

  return source.replace(find, replace);
}

function applyUnifiedDiffPatch(source: string, diffText: string, expectedPath: string, expectedId: string): string {
  const patches = parsePatch(diffText);
  if (patches.length !== 1) {
    throw new SailError(
      `patch --diff requires exactly one unified diff for the target node.\n` +
        `What to do: pass a diff that changes only ${expectedPath}.`
    );
  }

  const [patch] = patches;
  const fileNames = [patch.oldFileName, patch.newFileName].filter(Boolean);
  const expectedFileName = path.basename(expectedPath);
  const allowedNames = new Set([
    expectedPath,
    `a/${expectedPath}`,
    `b/${expectedPath}`,
    expectedFileName,
    `a/${expectedFileName}`,
    `b/${expectedFileName}`,
    `${expectedId}.ts`,
    `a/${expectedId}.ts`,
    `b/${expectedId}.ts`
  ]);

  if (fileNames.some((fileName) => !allowedNames.has(fileName))) {
    throw new SailError(
      `patch --diff targeted a different file.\n` +
        `What to do: pass a unified diff that only edits ${expectedPath}.`
    );
  }

  const output = applyPatch(source, diffText);
  if (output === false || output === source) {
    throw new SailError(
      `patch --diff did not apply cleanly.\n` +
        `What to do: regenerate the diff against the current file contents and retry.`
    );
  }

  return output;
}

async function buildImplementationTestFeedback(
  projectRoot: string,
  node: GraphNode,
  projectState: ProjectState
): Promise<{ quality: QualitySummary; warnings: string[] }> {
  const complexity = analyzeFunctionComplexity(node.source);
  const recommendedTests = Math.max(1, complexity);
  const specPath = await getSpecPath(projectRoot, node.id);
  const warnings: string[] = [];
  let testsFound = 0;

  const specExists = await fs
    .access(specPath)
    .then(() => true)
    .catch(() => false);

  if (specExists) {
    const spec = await readSpecFile(projectRoot, node.id);
    testsFound = countSpecTests(spec.source);
  }

  if (!specExists) {
    warnings.push(
      `WARNING: Node ${node.id} has estimated complexity ${complexity} and no tests. ` +
        `Recommended rough minimum: ${recommendedTests}. ` +
        `Next step: create tests with \`sail test write ${node.id}\`.`
    );
  } else if (testsFound < recommendedTests) {
    warnings.push(
      `WARNING: Node ${node.id} has ${testsFound} test${testsFound === 1 ? "" : "s"}. ` +
        `Recommended rough minimum: ${recommendedTests}. ` +
        `Next step: add tests with \`sail test write ${node.id}\` or \`sail test patch ${node.id}\`.`
    );
  }

  const specRun = await runTargetSpec(projectRoot, node.id);
  if (specRun.status === "failed") {
    warnings.push(
      `WARNING: Tests for node ${node.id} are failing ` +
        `(${specRun.failed} failed, ${specRun.passed} passed, ${specRun.total} total). ` +
        `Next step: fix node ${node.id} or patch its tests before continuing.`
    );
  } else if (specRun.status === "unavailable") {
    warnings.push(
      `WARNING: Could not run tests for node ${node.id}. ${specRun.reason} ` +
        `Next step: install Vitest in the project, then rerun the change.`
    );
  }

  const debtEntries = await analyzeTestDebt(projectRoot, projectState);
  warnings.push(...renderDebtWarnings(debtEntries));

  return {
    quality: {
      complexity,
      debtCount: debtEntries.length,
      debtNodes: debtEntries,
      failedTests: specRun.status === "failed" ? specRun.failed : undefined,
      nodeId: node.id,
      passedTests: specRun.status === "failed" || specRun.status === "passed" ? specRun.passed : undefined,
      recommendedTests,
      specStatus: specRun.status,
      testsFound,
      totalTests: specRun.status === "failed" || specRun.status === "passed" ? specRun.total : undefined
    },
    warnings
  };
}

async function buildSpecExecutionWarnings(
  projectRoot: string,
  id: string,
  projectState: ProjectState
): Promise<{ quality: QualitySummary; warnings: string[] }> {
  const specRun = await runTargetSpec(projectRoot, id);
  const warnings: string[] = [];

  if (specRun.status === "failed") {
    warnings.push(
      `WARNING: Tests for node ${id} are failing ` +
        `(${specRun.failed} failed, ${specRun.passed} passed, ${specRun.total} total). ` +
        `Next step: patch the tests for node ${id} or fix the implementation before continuing.`
    );
  } else if (specRun.status === "unavailable") {
    warnings.push(
      `WARNING: Could not run tests for node ${id}. ${specRun.reason} ` +
        `Next step: install Vitest in the project, then rerun the command.`
    );
  }

  const debtEntries = await analyzeTestDebt(projectRoot, projectState);
  warnings.push(...renderDebtWarnings(debtEntries));

  return {
    quality: {
      debtCount: debtEntries.length,
      debtNodes: debtEntries,
      failedTests: specRun.status === "failed" ? specRun.failed : undefined,
      nodeId: id,
      passedTests: specRun.status === "failed" || specRun.status === "passed" ? specRun.passed : undefined,
      specStatus: specRun.status,
      totalTests: specRun.status === "failed" || specRun.status === "passed" ? specRun.total : undefined
    },
    warnings
  };
}

async function runPatch(input: Extract<CommandInput, { command: "patch" }>): Promise<CommandResult> {
  await assertNoOutstandingTestDebt(input.projectRoot);
  const hasExactMode = typeof input.find === "string" || typeof input.replace === "string";
  if (input.diff === hasExactMode) {
    throw new SailError(
      `patch requires exactly one mode.\n` +
        `What to do: use either \`sail patch <id> --find <old> --replace <new>\` or \`sail patch <id> --diff\` with unified diff on stdin.`
    );
  }

  if (hasExactMode && (typeof input.find !== "string" || typeof input.replace !== "string")) {
    throw new SailError(
      `patch exact mode requires both --find and --replace.\n` +
        `What to do: provide both flags, or switch to \`--diff\` mode.`
    );
  }

  if (input.diff && !input.stdin.trim()) {
    throw new SailError(
      `patch --diff requires unified diff content on stdin.\n` +
        `What to do: pipe a unified diff into the command, for example: \`cat change.diff | sail patch ${input.id} --diff\`.`
    );
  }

  const beforeState = await buildProjectState(input.projectRoot, { validateTypes: false });
  const target = getNodeOrThrow(beforeState, input.id);
  const nextSource = input.diff
    ? applyUnifiedDiffPatch(target.source, input.stdin, target.pathFromRoot, target.id)
    : applyExactPatch(target.source, input.find!, input.replace!, `sail read ${target.id}`);

  await fs.writeFile(target.absPath, nextSource, "utf8");

  try {
    const afterState = await buildProjectState(input.projectRoot, { validateTypes: true });
    const updatedNode = getNodeOrThrow(afterState, target.id);
    const feedback =
      updatedNode.kind === "function"
        ? await buildImplementationTestFeedback(input.projectRoot, updatedNode, afterState)
        : {
            quality: {
              debtCount: (await analyzeTestDebt(input.projectRoot, afterState)).length,
              nodeId: updatedNode.id
            },
            warnings: renderDebtWarnings(await analyzeTestDebt(input.projectRoot, afterState))
          };
    return {
      quality: feedback.quality,
      projectState: afterState,
      shouldWriteSnapshot: true,
      stderr: feedback.warnings.join("\n"),
      stdout: `patched ${target.pathFromRoot}`,
      touchedNodes: [target.id]
    };
  } catch (error) {
    await fs.writeFile(target.absPath, target.source, "utf8");
    throw error;
  }
}

async function runInit(input: Extract<CommandInput, { command: "init" }>): Promise<CommandResult> {
  const stdout = await initProject(input.projectRoot, input.force);
  const projectState = await buildProjectState(input.projectRoot, { validateTypes: true });

  return {
    projectState,
    shouldWriteSnapshot: true,
    stderr: "",
    stdout,
    touchedNodes: ["index"]
  };
}

async function runWrite(input: Extract<CommandInput, { command: "write" }>): Promise<CommandResult> {
  await assertNoOutstandingTestDebt(input.projectRoot);
  if (!input.stdin.trim()) {
    throw new SailError(
      `write requires replacement file contents on stdin.\n` +
        `What to do: pipe a full valid TypeScript file into the command.\n` +
        `Example: printf 'export default async function main() {\\n  console.log(\"hello\");\\n}\\n\\ntry {\\n  await main();\\n} catch (error) {\\n  console.error(error);\\n  process.exit(1);\\n}\\n' | sail write main`
    );
  }

  const beforeState = await buildProjectState(input.projectRoot, { validateTypes: false });
  const resolvedId = input.id === "main" ? "index" : input.id;
  const existingTarget = beforeState.nodes.get(resolvedId);
  const targetPath = existingTarget
    ? path.join(input.projectRoot, existingTarget.pathFromRoot)
    : path.join(beforeState.graphSrcDir, `${resolvedId}.ts`);
  const previousSource = existingTarget?.source ?? null;

  await fs.writeFile(targetPath, input.stdin, "utf8");

  try {
    const afterState = await buildProjectState(input.projectRoot, { validateTypes: true });
    const createdNode = afterState.nodes.get(resolvedId);
    const feedback =
      createdNode && createdNode.kind === "function"
        ? await buildImplementationTestFeedback(input.projectRoot, createdNode, afterState)
        : {
            quality: {
              debtCount: (await analyzeTestDebt(input.projectRoot, afterState)).length,
              nodeId: createdNode ? createdNode.id : resolvedId
            },
            warnings: renderDebtWarnings(await analyzeTestDebt(input.projectRoot, afterState))
          };

    return {
      quality: feedback.quality,
      projectState: afterState,
      shouldWriteSnapshot: true,
      stderr: feedback.warnings.join("\n"),
      stdout: `${existingTarget ? "wrote" : "created"} ${path.relative(input.projectRoot, targetPath)}`,
      touchedNodes: [createdNode?.id ?? resolvedId]
    };
  } catch (error) {
    if (previousSource === null) {
      await fs.unlink(targetPath).catch(() => undefined);
    } else {
      await fs.writeFile(targetPath, previousSource, "utf8");
    }
    throw error;
  }
}

async function runTestRead(input: Extract<CommandInput, { command: "test-read" }>): Promise<CommandResult> {
  const projectState = await buildProjectState(input.projectRoot, { validateTypes: false });
  const node = getNodeOrThrow(projectState, input.id);
  const spec = await readSpecFile(input.projectRoot, node.id);

  return {
    projectState,
    shouldWriteSnapshot: false,
    stderr: "",
    stdout: renderRawFile(spec.pathFromRoot, spec.source),
    touchedNodes: [node.id]
  };
}

async function runTestWrite(input: Extract<CommandInput, { command: "test-write" }>): Promise<CommandResult> {
  if (!input.stdin.trim()) {
    throw new SailError(
      `test write requires replacement test contents on stdin.\n` +
        `What to do: pipe a full valid Vitest file into the command.\n` +
        `Example: printf 'import { describe, expect, it } from \"vitest\";\\n\\ndescribe(\"exampleRoutine\", () => {\\n  it(\"works\", () => {\\n    expect(true).toBe(true);\\n  });\\n});\\n' | sail test write exampleRoutine`
    );
  }

  const projectState = await buildProjectState(input.projectRoot, { validateTypes: false });
  const node = getNodeOrThrow(projectState, input.id);
  const targetPath = await getSpecPath(input.projectRoot, node.id);
  const previousSource = await fs.readFile(targetPath, "utf8").catch(() => null);

  await fs.writeFile(targetPath, input.stdin, "utf8");

  try {
    await buildTestState(input.projectRoot, { validateTypes: false });
    const refreshedProjectState = await buildProjectState(input.projectRoot, { validateTypes: false });
    const feedback = await buildSpecExecutionWarnings(input.projectRoot, node.id, refreshedProjectState);

    return {
      quality: {
        ...feedback.quality,
        nodeId: node.id,
        testsFound: countSpecTests(input.stdin)
      },
      projectState: refreshedProjectState,
      shouldWriteSnapshot: false,
      stderr: feedback.warnings.join("\n"),
      stdout: `${previousSource === null ? "created" : "wrote"} tests for ${node.id}`,
      touchedNodes: [node.id]
    };
  } catch (error) {
    if (previousSource === null) {
      await fs.unlink(targetPath).catch(() => undefined);
    } else {
      await fs.writeFile(targetPath, previousSource, "utf8");
    }

    throw error;
  }
}

async function runTestPatch(input: Extract<CommandInput, { command: "test-patch" }>): Promise<CommandResult> {
  const hasExactMode = typeof input.find === "string" || typeof input.replace === "string";
  if (input.diff === hasExactMode) {
    throw new SailError(
      `test patch requires exactly one mode.\n` +
        `What to do: use either \`sail test patch <id> --find <old> --replace <new>\` or \`sail test patch <id> --diff\` with unified diff on stdin.`
    );
  }

  if (hasExactMode && (typeof input.find !== "string" || typeof input.replace !== "string")) {
    throw new SailError(
      `test patch exact mode requires both --find and --replace.\n` +
        `What to do: provide both flags, or switch to \`--diff\` mode.`
    );
  }

  if (input.diff && !input.stdin.trim()) {
    throw new SailError(
      `test patch --diff requires unified diff content on stdin.\n` +
        `What to do: pipe a unified diff into the command, for example: \`cat change.diff | sail test patch ${input.id} --diff\`.`
    );
  }

  const projectState = await buildProjectState(input.projectRoot, { validateTypes: false });
  const node = getNodeOrThrow(projectState, input.id);
  const target = await readSpecFile(input.projectRoot, node.id);
  const nextSource = input.diff
    ? applyUnifiedDiffPatch(target.source, input.stdin, target.pathFromRoot, `${node.id}.spec`)
    : applyExactPatch(target.source, input.find!, input.replace!, `sail test read ${node.id}`);

  await fs.writeFile(target.absPath, nextSource, "utf8");

  try {
    await buildTestState(input.projectRoot, { validateTypes: false });
    const refreshedProjectState = await buildProjectState(input.projectRoot, { validateTypes: false });
    const feedback = await buildSpecExecutionWarnings(input.projectRoot, node.id, refreshedProjectState);

    return {
      quality: {
        ...feedback.quality,
        nodeId: node.id,
        testsFound: countSpecTests(nextSource)
      },
      projectState: refreshedProjectState,
      shouldWriteSnapshot: false,
      stderr: feedback.warnings.join("\n"),
      stdout: `patched tests for ${node.id}`,
      touchedNodes: [node.id]
    };
  } catch (error) {
    await fs.writeFile(target.absPath, target.source, "utf8");
    throw error;
  }
}

export default async function runCommand(input: CommandInput): Promise<CommandResult> {
  switch (input.command) {
    case "init":
      return runInit(input);
    case "graph":
      return runGraph(input);
    case "patch":
      return runPatch(input);
    case "query":
      return runQuery(input);
    case "read":
      return runRead(input);
    case "test-patch":
      return runTestPatch(input);
    case "test-read":
      return runTestRead(input);
    case "test-write":
      return runTestWrite(input);
    case "write":
      return runWrite(input);
    default:
      throw new SailError(`Unsupported command.`);
  }
}
