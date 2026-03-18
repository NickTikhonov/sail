import fs from "node:fs/promises";
import path from "node:path";
import { Project } from "ts-morph";
import readSailConfig from "./readSailConfig.js";

export type ImportBoundaryDebtEntry = {
  importerPath: string;
  targetPath: string;
};

function pathStartsWith(targetPath: string, parentPath: string): boolean {
  const relative = path.relative(parentPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export default async function analyzeImportBoundaryDebt(
  projectRoot: string
): Promise<ImportBoundaryDebtEntry[]> {
  const config = await readSailConfig(projectRoot);
  const tsconfigPath = path.join(projectRoot, "tsconfig.json");
  const hasTsconfig = await fs
    .access(tsconfigPath)
    .then(() => true)
    .catch(() => false);
  if (!hasTsconfig) {
    return [];
  }

  const publicIndexPath = path.join(config.graphSrcDir, "index.ts");
  const project = new Project({
    skipAddingFilesFromTsConfig: false,
    tsConfigFilePath: tsconfigPath
  });

  const debtEntries = new Map<string, ImportBoundaryDebtEntry>();
  for (const sourceFile of project.getSourceFiles()) {
    const importerPath = sourceFile.getFilePath();
    if (pathStartsWith(importerPath, config.graphSrcDir)) {
      continue;
    }

    for (const declaration of sourceFile.getImportDeclarations()) {
      const targetSourceFile = declaration.getModuleSpecifierSourceFile();
      if (!targetSourceFile) {
        continue;
      }

      const targetPath = targetSourceFile.getFilePath();
      if (!pathStartsWith(targetPath, config.graphSrcDir)) {
        continue;
      }

      if (targetPath === publicIndexPath) {
        continue;
      }

      const key = `${importerPath}::${targetPath}`;
      debtEntries.set(key, {
        importerPath: path.relative(projectRoot, importerPath),
        targetPath: path.relative(projectRoot, targetPath)
      });
    }
  }

  return [...debtEntries.values()].sort((left, right) => {
    if (left.importerPath !== right.importerPath) {
      return left.importerPath.localeCompare(right.importerPath);
    }
    return left.targetPath.localeCompare(right.targetPath);
  });
}
