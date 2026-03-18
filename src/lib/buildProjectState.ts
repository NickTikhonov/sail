import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Node, Project, SyntaxKind, ts } from "ts-morph";
import SailError from "./SailError.js";
import readSailConfig from "./readSailConfig.js";
import {
  collectManagedTypeScriptFiles,
  describeNodeFilePath,
  isNodeFilePath,
  stripNodeFileExtension
} from "./typescriptFiles.js";

type NodeKind = "const" | "function" | "main" | "surface" | "type";

type GraphNode = {
  absPath: string;
  id: string;
  importedBy: string[];
  imports: string[];
  kind: NodeKind;
  pathFromGraphSrc: string;
  pathFromRoot: string;
  source: string;
};

type GraphSummary = {
  edgeCount: number;
  graphHash: string;
  nodeCount: number;
};

type ProjectState = {
  cwdHash: string;
  graphSrc: string;
  graphSrcDir: string;
  graphSummary: GraphSummary;
  nodes: Map<string, GraphNode>;
  projectRoot: string;
  reverseEdges: Map<string, Set<string>>;
};

type BuildProjectStateOptions = {
  validateTypes?: boolean;
};

type ClassifiedExport = {
  kind: NodeKind;
  name: string;
};

const JSX_SHIM_SOURCE = `declare namespace JSX {
  interface Element {}
  interface IntrinsicElements {
    [elementName: string]: unknown;
  }
}
`;

function isLocalImport(moduleSpecifier: string): boolean {
  return moduleSpecifier.startsWith(".");
}

function hashText(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

async function collectSourceFiles(srcDir: string): Promise<string[]> {
  return (await collectManagedTypeScriptFiles(srcDir)).filter((filePath) => isNodeFilePath(filePath));
}

function getTopLevelExecutableStatements(sourceFilePath: string, statements: Node<ts.Node>[]): string[] {
  let directivePrologueOpen = true;
  return statements
    .filter((statement) => {
      if (
        directivePrologueOpen &&
        Node.isExpressionStatement(statement) &&
        (() => {
          const expression = statement.getExpression();
          return Node.isStringLiteral(expression) || Node.isNoSubstitutionTemplateLiteral(expression);
        })()
      ) {
        return false;
      }

      directivePrologueOpen = false;

      if (
        Node.isImportDeclaration(statement) ||
        Node.isExportDeclaration(statement) ||
        Node.isExportAssignment(statement) ||
        Node.isFunctionDeclaration(statement) ||
        Node.isInterfaceDeclaration(statement) ||
        Node.isTypeAliasDeclaration(statement) ||
        Node.isVariableStatement(statement)
      ) {
        return false;
      }

      if (sourceFilePath.endsWith(`${path.sep}index.ts`) && Node.isTryStatement(statement)) {
        return false;
      }

      return true;
    })
    .map((statement) => statement.getKindName());
}

function isIndexPublicSurface(sourceFile: import("ts-morph").SourceFile, fileId: string): boolean {
  if (fileId !== "index") {
    return false;
  }

  const hasDefaultFunction = sourceFile.getFunctions().some((declaration) => declaration.isDefaultExport());
  const hasDefaultInterface = sourceFile.getInterfaces().some((declaration) => declaration.isDefaultExport());
  const hasExportAssignment = sourceFile.getExportAssignments().length > 0;
  if (hasDefaultFunction || hasDefaultInterface || hasExportAssignment) {
    return false;
  }

  return sourceFile.getExportDeclarations().length > 0;
}

function validateOnlyDefaultExportSurface(sourceFile: import("ts-morph").SourceFile, fileId: string): void {
  const fileLabel = sourceFile.getBaseName();
  if (isIndexPublicSurface(sourceFile, fileId)) {
    const hasNamedFunctionExport = sourceFile.getFunctions().some((declaration) => declaration.hasExportKeyword());
    const hasNamedInterfaceExport = sourceFile.getInterfaces().some((declaration) => declaration.hasExportKeyword());
    const hasNamedVariableExport = sourceFile
      .getVariableStatements()
      .some((statement) => statement.hasExportKeyword());
    if (hasNamedFunctionExport || hasNamedInterfaceExport || hasNamedVariableExport) {
      throw new SailError(
        `The public surface in index.ts must use re-exports only.\n` +
          `What to do: re-export sail nodes from \`index.ts\` using statements like \`export { default as foo } from "./foo"\`.`
      );
    }
    return;
  }

  if (sourceFile.getExportDeclarations().length > 0) {
    throw new SailError(
      `Named export declarations are not allowed in ${fileLabel}.\n` +
        `What to do: keep one public node per file and expose it only through the single default export.`
    );
  }

  const hasNamedFunctionExport = sourceFile
    .getFunctions()
    .some((declaration) => declaration.hasExportKeyword() && !declaration.isDefaultExport());
  if (hasNamedFunctionExport) {
    throw new SailError(
      `Named function exports are not allowed in ${fileLabel}.\n` +
        `What to do: keep one public node per file and expose it only through the single default export.`
    );
  }

  const hasNamedInterfaceExport = sourceFile
    .getInterfaces()
    .some((declaration) => declaration.hasExportKeyword() && !declaration.isDefaultExport());
  if (hasNamedInterfaceExport) {
    throw new SailError(
      `Named interface exports are not allowed in ${fileLabel}.\n` +
        `What to do: keep one public node per file and expose it only through the single default export.`
    );
  }

  const hasNamedVariableExport = sourceFile
    .getVariableStatements()
    .some((statement) => statement.hasExportKeyword());
  if (hasNamedVariableExport) {
    throw new SailError(
      `Named variable exports are not allowed in ${fileLabel}.\n` +
        `What to do: keep one public node per file and expose it only through the single default export.`
    );
  }
}

function classifyExport(sourceFile: import("ts-morph").SourceFile, fileId: string): ClassifiedExport {
  const fileLabel = sourceFile.getBaseName();
  if (isIndexPublicSurface(sourceFile, fileId)) {
    return {
      kind: "surface",
      name: "index"
    };
  }

  for (const declaration of sourceFile.getFunctions()) {
    if (declaration.isDefaultExport()) {
      const name = declaration.getName();
      if (!name) {
        throw new SailError(
          `Default-exported function in ${fileLabel} must be named.\n` +
            `What to do: export a named function whose name matches the filename.`
        );
      }

      return {
        kind: fileId === "index" ? "main" : "function",
        name
      };
    }
  }

  for (const declaration of sourceFile.getInterfaces()) {
    if (declaration.isDefaultExport()) {
      const name = declaration.getName();
      if (!name) {
        throw new SailError(
          `Default-exported interface in ${fileLabel} must be named.\n` +
            `What to do: export a named interface whose name matches the filename.`
        );
      }

      return {
        kind: "type",
        name
      };
    }
  }

  for (const declaration of sourceFile.getTypeAliases()) {
    if (declaration.hasExportKeyword()) {
      throw new SailError(
        `Type aliases in ${fileLabel} cannot be default exported in TypeScript.\n` +
          `What to do: use a default-exported interface for MVP type nodes.`
      );
    }
  }

  for (const exportAssignment of sourceFile.getExportAssignments()) {
    if (exportAssignment.isExportEquals()) {
      throw new SailError(
        `CommonJS export assignment is not allowed in ${fileLabel}.\n` +
          `What to do: use ESM default export syntax instead.`
      );
    }

    const expression = exportAssignment.getExpression();
    if (!Node.isIdentifier(expression)) {
      throw new SailError(
        `Default export in ${fileLabel} must reference a named symbol.\n` +
          `What to do: declare a local named function, const, or interface and default export that symbol.`
      );
    }

    const name = expression.getText();
    const variableDeclaration = sourceFile.getVariableDeclaration(name);
    if (variableDeclaration) {
      const variableStatement = variableDeclaration.getVariableStatement();
      const declarationKind = variableStatement?.getDeclarationKind();
      if (declarationKind !== "const") {
        throw new SailError(
          `Default-exported variable in ${fileLabel} must be declared with const.\n` +
            `What to do: replace let/var with const.`
        );
      }

      const initializer = variableDeclaration.getInitializer();
      if (initializer && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))) {
        return {
          kind: "function",
          name
        };
      }

      return {
        kind: "const",
        name
      };
    }

    const functionDeclaration = sourceFile.getFunction(name);
    if (functionDeclaration) {
      return {
        kind: fileId === "index" ? "main" : "function",
        name
      };
    }

    throw new SailError(
      `Default export in ${fileLabel} must reference a local function or const.\n` +
        `What to do: define the symbol in the same file, then default export it.`
    );
  }

  throw new SailError(
    `Expected exactly one default export in ${fileLabel}.\n` +
      `What to do: keep one public node per file and export it as the single default export.`
  );
}

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
      `TypeScript syntax validation failed.\n` +
        `What to do: fix the parse errors in the file you just changed, then retry the command.\n${message}`
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
    `TypeScript compile validation failed.\n` +
      `What to do: fix the TypeScript errors introduced by the change, then retry the command.\n${message}`
  );
}

function validateIndexSourceFile(sourceFile: import("ts-morph").SourceFile, graphSrc: string): void {
  const fileId = stripNodeFileExtension(sourceFile.getBaseName());
  const statements = sourceFile.getStatements();
  const executableStatements = getTopLevelExecutableStatements(sourceFile.getFilePath(), statements);
  if (executableStatements.length > 0) {
    throw new SailError(
      `Top-level executable statements are not allowed in ${sourceFile.getBaseName()}: ${executableStatements.join(", ")}.\n` +
        `What to do: pass a full valid node file to \`write\`, not raw text. Keep top-level code to declarations only. ` +
        `The only exception is \`${path.join(graphSrc, "index.ts")}\`, which may invoke \`main()\` inside a local try/catch block.`
    );
  }

  validateOnlyDefaultExportSurface(sourceFile, fileId);

  const classified = classifyExport(sourceFile, fileId);
  if (classified.kind === "surface") {
    return;
  }

  if (classified.kind !== "main") {
    return;
  }

  if (classified.name !== "main") {
    throw new SailError(
      `${path.join(graphSrc, "index.ts")} must default export an async function named main.\n` +
        `What to do: define \`export default async function main() { ... }\`.`
    );
  }

  const mainFunction = sourceFile.getFunction("main");
  if (!mainFunction || !mainFunction.isAsync()) {
    throw new SailError(
      `${path.join(graphSrc, "index.ts")} must default export an async function named main.\n` +
        `What to do: define \`export default async function main() { ... }\`.`
    );
  }

  const hasTryCatchInvocation = sourceFile
    .getDescendantsOfKind(SyntaxKind.TryStatement)
    .some((statement) => statement.getCatchClause() && statement.getText().includes("main("));

  if (!hasTryCatchInvocation) {
    throw new SailError(
      `${path.join(graphSrc, "index.ts")} must invoke main() inside a local try/catch block.\n` +
        `What to do: add:\ntry {\n  await main();\n} catch (error) {\n  console.error(error);\n  process.exit(1);\n}`
    );
  }
}

function ensureOnlyStaticImports(sourceFile: import("ts-morph").SourceFile): void {
  if (sourceFile.getDescendantsOfKind(SyntaxKind.ImportEqualsDeclaration).length > 0) {
    throw new SailError(
      `Import equals declarations are not allowed in ${sourceFile.getBaseName()}.\n` +
        `What to do: use static ESM imports like \`import foo from "./foo"\`.`
    );
  }

  const dynamicImport = sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((expression) => expression.getExpression().getKind() === SyntaxKind.ImportKeyword);

  if (dynamicImport) {
    throw new SailError(
      `Dynamic imports are not allowed in ${sourceFile.getBaseName()}.\n` +
        `What to do: use static imports only so the dependency graph can be indexed.`
    );
  }
}

function computeGraphSummary(nodes: Map<string, GraphNode>): GraphSummary {
  const serialized = [...nodes.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((node) => ({
      id: node.id,
      imports: [...node.imports].sort(),
      kind: node.kind,
      path: node.pathFromRoot
    }));

  const edgeCount = serialized.reduce((count, node) => count + node.imports.length, 0);

  return {
    edgeCount,
    graphHash: hashText(JSON.stringify(serialized)),
    nodeCount: serialized.length
  };
}

export default async function buildProjectState(
  projectRoot: string,
  options: BuildProjectStateOptions = {}
): Promise<ProjectState> {
  const config = await readSailConfig(projectRoot);
  const graphSrcStats = await fs.stat(config.graphSrcDir).catch(() => null);
  if (!graphSrcStats?.isDirectory()) {
    throw new SailError(
      `Expected the configured graph source directory \`${config.graphSrc}\` to exist.\n` +
        `What to do: create \`${config.graphSrc}\`, or update \`sail.config.json\` to point at the correct directory.`
    );
  }

  const files = await collectSourceFiles(config.graphSrcDir);
  if (!files.some((filePath) => filePath === path.join(config.graphSrcDir, "index.ts"))) {
    throw new SailError(
      `Expected ${path.join(config.graphSrc, "index.ts")} to exist.\n` +
        `What to do: run \`sail init\` to create the required entrypoint file, or add it yourself.`
    );
  }

  const project = new Project({
    compilerOptions: {
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2022
    },
    skipAddingFilesFromTsConfig: true
  });

  const sourceFiles = files.map((filePath) => project.addSourceFileAtPath(filePath));
  project.createSourceFile("__sail_jsx_shim.d.ts", JSX_SHIM_SOURCE, { overwrite: true });

  for (const sourceFile of sourceFiles) {
    ensureOnlyStaticImports(sourceFile);
    validateIndexSourceFile(sourceFile, config.graphSrc);
  }

  validateDiagnostics(project, options.validateTypes ?? false);

  const idToPaths = new Map<string, string[]>();
  for (const filePath of files) {
    const id = stripNodeFileExtension(path.basename(filePath));
    idToPaths.set(id, [...(idToPaths.get(id) ?? []), filePath]);
  }
  for (const [id, matchingPaths] of idToPaths.entries()) {
    if (matchingPaths.length > 1) {
      throw new SailError(
        `Found multiple implementation files for node ${id}.\n` +
          `What to do: keep a single node file at ${describeNodeFilePath(config.graphSrc, id)}.`
      );
    }
  }

  const nodes = new Map<string, GraphNode>();
  const reverseEdges = new Map<string, Set<string>>();

  for (const sourceFile of sourceFiles) {
    const id = stripNodeFileExtension(sourceFile.getBaseName());
    const classified = classifyExport(sourceFile, id);
    if (classified.name !== id && !(id === "index" && classified.name === "main")) {
      throw new SailError(
        `Filename and exported symbol must match in ${sourceFile.getBaseName()}. Expected ${id}.\n` +
          `What to do: rename the exported symbol to match the filename, or rename the file to match the symbol.`
      );
    }

    const imports = [
      ...sourceFile.getImportDeclarations().map((declaration) => ({
        moduleSpecifier: declaration.getModuleSpecifierValue(),
        targetSourceFile: declaration.getModuleSpecifierSourceFile()
      })),
      ...sourceFile
        .getExportDeclarations()
        .filter((declaration) => declaration.getModuleSpecifierValue())
        .map((declaration) => ({
          moduleSpecifier: declaration.getModuleSpecifierValue(),
          targetSourceFile: declaration.getModuleSpecifierSourceFile()
        }))
    ].flatMap(({ moduleSpecifier, targetSourceFile }) => {
      if (!isLocalImport(moduleSpecifier)) {
        return [];
      }

      if (!targetSourceFile) {
        throw new SailError(
          `Local import ${moduleSpecifier} in ${sourceFile.getBaseName()} does not resolve to a project file.\n` +
            `What to do: create the imported node under \`${config.graphSrc}/\`, or fix the import path so it points to an existing local file.`
        );
      }

      const targetPath = targetSourceFile.getFilePath();
      if (!targetPath.startsWith(config.graphSrcDir)) {
        throw new SailError(
          `Local import ${moduleSpecifier} in ${sourceFile.getBaseName()} resolves outside ${config.graphSrc}.\n` +
            `What to do: only import files that live under \`${config.graphSrc}/\`.`
        );
      }

      return [stripNodeFileExtension(targetSourceFile.getBaseName())];
    });

    const node: GraphNode = {
      absPath: sourceFile.getFilePath(),
      id,
      importedBy: [],
      imports: [...new Set(imports)].sort(),
      kind: classified.kind,
      pathFromGraphSrc: path.relative(config.graphSrcDir, sourceFile.getFilePath()),
      pathFromRoot: path.relative(projectRoot, sourceFile.getFilePath()),
      source: sourceFile.getFullText()
    };

    nodes.set(id, node);
    reverseEdges.set(id, new Set());
  }

  for (const node of nodes.values()) {
    for (const importedId of node.imports) {
      const target = nodes.get(importedId);
      if (!target) {
        throw new SailError(
          `Node ${node.id} imports missing local node ${importedId}.\n` +
            `What to do: add \`${describeNodeFilePath(config.graphSrc, importedId)}\` or fix the import path.`
        );
      }

      reverseEdges.get(importedId)?.add(node.id);
    }
  }

  for (const node of nodes.values()) {
    node.importedBy = [...(reverseEdges.get(node.id) ?? new Set())].sort();
  }

  return {
    cwdHash: hashText(projectRoot),
    graphSrc: config.graphSrc,
    graphSrcDir: config.graphSrcDir,
    graphSummary: computeGraphSummary(nodes),
    nodes,
    projectRoot,
    reverseEdges
  };
}
