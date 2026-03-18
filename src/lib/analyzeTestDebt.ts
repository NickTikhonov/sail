import fs from "node:fs/promises";
import analyzeFunctionComplexity from "./analyzeFunctionComplexity.js";
import buildProjectState from "./buildProjectState.js";
import countSpecTests from "./countSpecTests.js";
import { getSpecPath } from "./testFiles.js";

type ProjectState = Awaited<ReturnType<typeof buildProjectState>>;

export type TestDebtEntry = {
  complexity: number;
  nodeId: string;
  recommendedTests: number;
  testsFound: number;
};

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export default async function analyzeTestDebt(
  projectRoot: string,
  projectState: ProjectState
): Promise<TestDebtEntry[]> {
  const functionNodes = [...projectState.nodes.values()]
    .filter((node) => node.kind === "function")
    .sort((left, right) => left.id.localeCompare(right.id));

  const debtEntries = await Promise.all(
    functionNodes.map(async (node) => {
      const complexity = analyzeFunctionComplexity(node.source);
      const recommendedTests = Math.max(1, complexity);
      const specPath = await getSpecPath(projectRoot, node.id);
      const testsFound = (await pathExists(specPath))
        ? countSpecTests(await fs.readFile(specPath, "utf8"))
        : 0;

      if (testsFound >= recommendedTests) {
        return null;
      }

      return {
        complexity,
        nodeId: node.id,
        recommendedTests,
        testsFound
      };
    })
  );

  return debtEntries.filter((entry): entry is TestDebtEntry => entry !== null);
}
