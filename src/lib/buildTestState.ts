import fs from "node:fs/promises";
import path from "node:path";
import { Project, ts } from "ts-morph";
import SailError from "./SailError.js";
import readSailConfig from "./readSailConfig.js";
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
  graphSrc: string;
  graphSrcDir: string;
  projectRoot: string;
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
    throw new SailError(
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
  throw new SailError(
    `TypeScript compile validation failed in test files.\n` +
      `What to do: fix the test TypeScript errors you just introduced, then retry the command.\n${message}`
  );
}

export default async function buildTestState(
  projectRoot: string,
  options: BuildTestStateOptions = {}
): Promise<TestState> {
  const config = await readSailConfig(projectRoot);
  const graphSrcStats = await fs.stat(config.graphSrcDir).catch(() => null);
  if (!graphSrcStats?.isDirectory()) {
    throw new SailError(
      `Expected the configured graph source directory \`${config.graphSrc}\` to exist.\n` +
        `What to do: create \`${config.graphSrc}\`, or update \`sail.config.json\` to point at the correct directory.`
    );
  }

  const files = await collectTypeScriptFiles(config.graphSrcDir);
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
    const implementationPath = path.join(config.graphSrcDir, `${id}.ts`);
    const hasImplementation = files.includes(implementationPath);
    if (!hasImplementation) {
      throw new SailError(
        `Found tests for missing node ${id}.\n` +
          `What to do: add node ${id}, or remove the orphaned tests at ${getSpecPathFromId(config.graphSrc, id)}.`
      );
    }

    tests.set(id, {
      absPath: sourceFile.getFilePath(),
      id,
      pathFromRoot: getSpecPathFromId(config.graphSrc, id),
      source: sourceFile.getFullText()
    });
  }

  return {
    graphSrc: config.graphSrc,
    graphSrcDir: config.graphSrcDir,
    projectRoot,
    tests
  };
}
