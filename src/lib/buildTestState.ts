import fs from "node:fs/promises";
import path from "node:path";
import { Project, ts } from "ts-morph";
import AgentScriptError from "./AgentScriptError.js";
import { collectTypeScriptFiles, getSpecPathFromId, isSpecFilePath } from "./testFiles.js";

type TestNode = {
  absPath: string;
  id: string;
  pathFromRoot: string;
  source: string;
};

type BuildTestStateOptions = {
  validateTypes?: boolean;
};

type TestState = {
  projectRoot: string;
  srcDir: string;
  tests: Map<string, TestNode>;
};

function validateDiagnostics(project: Project, validateTypes: boolean): void {
  const syntaxDiagnostics = project
    .getSourceFiles()
    .flatMap((sourceFile) => {
      const compilerSourceFile = sourceFile.compilerNode as ts.SourceFile & {
        parseDiagnostics?: readonly ts.DiagnosticWithLocation[];
      };

      return compilerSourceFile.parseDiagnostics ?? [];
    });

  if (syntaxDiagnostics.length > 0) {
    const message = ts.formatDiagnosticsWithColorAndContext(syntaxDiagnostics, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => "\n"
    });
    throw new AgentScriptError(
      `TypeScript syntax validation failed in test files.\n` +
        `What to do: fix the parse errors in the tests you just changed, then retry the command.\n${message}`
    );
  }

  if (!validateTypes) {
    return;
  }

  const typeDiagnostics = project.getPreEmitDiagnostics();
  if (typeDiagnostics.length === 0) {
    return;
  }

  const message = project.formatDiagnosticsWithColorAndContext(typeDiagnostics);
  throw new AgentScriptError(
    `TypeScript compile validation failed in test files.\n` +
      `What to do: fix the test TypeScript errors you just introduced, then retry the command.\n${message}`
  );
}

export default async function buildTestState(
  projectRoot: string,
  options: BuildTestStateOptions = {}
): Promise<TestState> {
  const srcDir = path.join(projectRoot, "src");
  const srcStats = await fs.stat(srcDir).catch(() => null);
  if (!srcStats?.isDirectory()) {
    throw new AgentScriptError(
      `Expected a src/ directory in ${projectRoot}.\n` +
        `What to do: run \`agentscript init\` from the project root to create a starter project.`
    );
  }

  const files = await collectTypeScriptFiles(srcDir);
  const project = new Project({
    compilerOptions: {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2022
    },
    skipAddingFilesFromTsConfig: true
  });

  const sourceFiles = files.map((filePath) => project.addSourceFileAtPath(filePath));
  validateDiagnostics(project, options.validateTypes ?? false);

  const tests = new Map<string, TestNode>();
  for (const sourceFile of sourceFiles) {
    if (!isSpecFilePath(sourceFile.getFilePath())) {
      continue;
    }

    const baseName = sourceFile.getBaseName();
    const id = baseName.replace(/\.spec\.ts$/, "");
    const implementationPath = path.join(srcDir, `${id}.ts`);
    const hasImplementation = files.includes(implementationPath);
    if (!hasImplementation) {
      throw new AgentScriptError(
        `Found tests for missing node ${id}.\n` +
          `What to do: add node ${id}, or remove the orphaned tests at ${getSpecPathFromId(id)}.`
      );
    }

    tests.set(id, {
      absPath: sourceFile.getFilePath(),
      id,
      pathFromRoot: getSpecPathFromId(id),
      source: sourceFile.getFullText()
    });
  }

  return {
    projectRoot,
    srcDir,
    tests
  };
}
