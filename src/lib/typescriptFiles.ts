import fs from "node:fs/promises";
import path from "node:path";
import { ts } from "ts-morph";

export const NODE_FILE_EXTENSIONS = [".ts", ".tsx"] as const;
export const SPEC_FILE_EXTENSIONS = [".spec.ts", ".spec.tsx"] as const;

function hasAnySuffix(filePath: string, suffixes: readonly string[]): boolean {
  return suffixes.some((suffix) => filePath.endsWith(suffix));
}

export function isSpecFilePath(filePath: string): boolean {
  return hasAnySuffix(filePath, SPEC_FILE_EXTENSIONS);
}

export function isNodeFilePath(filePath: string): boolean {
  return (
    !filePath.endsWith(".d.ts") &&
    !isSpecFilePath(filePath) &&
    hasAnySuffix(filePath, NODE_FILE_EXTENSIONS)
  );
}

export function stripNodeFileExtension(fileName: string): string {
  if (fileName.endsWith(".tsx")) {
    return fileName.slice(0, -".tsx".length);
  }
  if (fileName.endsWith(".ts")) {
    return fileName.slice(0, -".ts".length);
  }
  return fileName;
}

export function stripSpecFileExtension(fileName: string): string {
  if (fileName.endsWith(".spec.tsx")) {
    return fileName.slice(0, -".spec.tsx".length);
  }
  if (fileName.endsWith(".spec.ts")) {
    return fileName.slice(0, -".spec.ts".length);
  }
  return fileName;
}

export function describeNodeFilePath(graphSrc: string, id: string): string {
  return path.join(graphSrc, `${id}.{ts,tsx}`);
}

export function describeSpecFilePath(graphSrc: string, id: string): string {
  return path.join(graphSrc, `${id}.spec.{ts,tsx}`);
}

export async function collectManagedTypeScriptFiles(srcDir: string): Promise<string[]> {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absPath = path.join(srcDir, entry.name);
      if (entry.isDirectory()) {
        return collectManagedTypeScriptFiles(absPath);
      }

      if (!entry.isFile() || (!isNodeFilePath(absPath) && !isSpecFilePath(absPath))) {
        return [];
      }

      return [absPath];
    })
  );

  return files.flat().sort();
}

async function resolveCandidatePaths(basePath: string, suffixes: readonly string[]): Promise<string[]> {
  const candidates = suffixes.map((suffix) => `${basePath}${suffix}`);
  const matches = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        return null;
      }
    })
  );

  return matches.filter((match): match is string => match !== null);
}

export async function resolveNodeFilePaths(graphSrcDir: string, id: string): Promise<string[]> {
  return resolveCandidatePaths(path.join(graphSrcDir, id), NODE_FILE_EXTENSIONS);
}

export async function resolveSpecFilePaths(graphSrcDir: string, id: string): Promise<string[]> {
  return resolveCandidatePaths(path.join(graphSrcDir, `${id}.spec`), [".ts", ".tsx"]);
}

function containsJsx(node: ts.Node): boolean {
  if (
    ts.isJsxElement(node) ||
    ts.isJsxSelfClosingElement(node) ||
    ts.isJsxFragment(node)
  ) {
    return true;
  }

  return ts.forEachChild(node, containsJsx) ?? false;
}

export function inferTypeScriptExtension(sourceText: string): ".ts" | ".tsx" {
  const tsSource = ts.createSourceFile("node.ts", sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const tsxSource = ts.createSourceFile(
    "node.tsx",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  const hasJsx = containsJsx(tsxSource);
  if (!hasJsx) {
    return ".ts";
  }

  return tsxSource.parseDiagnostics.length <= tsSource.parseDiagnostics.length ? ".tsx" : ".ts";
}

export function inferSpecFileSuffix(sourceText: string): ".spec.ts" | ".spec.tsx" {
  return inferTypeScriptExtension(sourceText) === ".tsx" ? ".spec.tsx" : ".spec.ts";
}
