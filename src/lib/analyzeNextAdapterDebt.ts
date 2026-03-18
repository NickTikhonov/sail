import fs from "node:fs/promises";
import path from "node:path";
import { Node, Project } from "ts-morph";
import readSailConfig from "./readSailConfig.js";

export type NextAdapterDebtEntry = {
  filePath: string;
  reason: string;
};

function pathStartsWith(targetPath: string, parentPath: string): boolean {
  const relative = path.relative(parentPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function isNextProject(projectRoot: string): Promise<boolean> {
  const appDir = path.join(projectRoot, "app");
  const hasAppDir = await fs
    .access(appDir)
    .then(() => true)
    .catch(() => false);
  if (!hasAppDir) {
    return false;
  }

  const packageJsonPath = path.join(projectRoot, "package.json");
  const packageJson = await fs
    .readFile(packageJsonPath, "utf8")
    .then((contents) => JSON.parse(contents))
    .catch(() => null);
  if (!packageJson || typeof packageJson !== "object") {
    return false;
  }

  const dependencies =
    packageJson.dependencies && typeof packageJson.dependencies === "object"
      ? packageJson.dependencies
      : {};
  const devDependencies =
    packageJson.devDependencies && typeof packageJson.devDependencies === "object"
      ? packageJson.devDependencies
      : {};

  return Boolean(dependencies.next || devDependencies.next);
}

function isSailRelatedFile(
  sourceFile: import("ts-morph").SourceFile,
  graphSrcDir: string
): boolean {
  const importTargets = sourceFile
    .getImportDeclarations()
    .map((declaration) => declaration.getModuleSpecifierSourceFile())
    .filter((target): target is import("ts-morph").SourceFile => target !== undefined);
  const exportTargets = sourceFile
    .getExportDeclarations()
    .map((declaration) => declaration.getModuleSpecifierSourceFile())
    .filter((target): target is import("ts-morph").SourceFile => target !== undefined);

  return [...importTargets, ...exportTargets].some((target) =>
    pathStartsWith(target.getFilePath(), graphSrcDir)
  );
}

function isPurePublicIndexReExport(
  sourceFile: import("ts-morph").SourceFile,
  publicIndexPath: string
): boolean {
  const statements = sourceFile.getStatements();
  if (statements.length === 0) {
    return false;
  }

  return statements.every((statement) => {
    if (!Node.isExportDeclaration(statement)) {
      return false;
    }

    const targetSourceFile = statement.getModuleSpecifierSourceFile();
    return targetSourceFile?.getFilePath() === publicIndexPath;
  });
}

export default async function analyzeNextAdapterDebt(
  projectRoot: string
): Promise<NextAdapterDebtEntry[]> {
  if (!(await isNextProject(projectRoot))) {
    return [];
  }

  const config = await readSailConfig(projectRoot);
  const tsconfigPath = path.join(projectRoot, "tsconfig.json");
  const hasTsconfig = await fs
    .access(tsconfigPath)
    .then(() => true)
    .catch(() => false);
  if (!hasTsconfig) {
    return [];
  }

  const appDir = path.join(projectRoot, "app");
  const publicIndexPath = path.join(config.graphSrcDir, "index.ts");
  const project = new Project({
    skipAddingFilesFromTsConfig: false,
    tsConfigFilePath: tsconfigPath
  });

  const debts: NextAdapterDebtEntry[] = [];
  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    if (!pathStartsWith(filePath, appDir)) {
      continue;
    }
    if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx")) {
      continue;
    }
    if (!isSailRelatedFile(sourceFile, config.graphSrcDir)) {
      continue;
    }
    if (isPurePublicIndexReExport(sourceFile, publicIndexPath)) {
      continue;
    }

    debts.push({
      filePath: path.relative(projectRoot, filePath),
      reason: "Next adapter files that touch sail must be pure re-export stubs from the sail public index."
    });
  }

  return debts.sort((left, right) => left.filePath.localeCompare(right.filePath));
}
