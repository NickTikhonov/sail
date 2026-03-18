import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { getSpecPath, pathExists } from "./testFiles.js";

type TargetSpecRunResult =
  | {
      status: "missing";
    }
  | {
      status: "unavailable";
      reason: string;
    }
  | {
      failed: number;
      passed: number;
      status: "passed" | "failed";
      total: number;
    };

type VitestJsonSummary = {
  numFailedTests?: number;
  numPassedTests?: number;
  numTotalTests?: number;
};

function getNpxCommand(): string {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function parseVitestSummary(raw: string): VitestJsonSummary | null {
  try {
    return JSON.parse(raw) as VitestJsonSummary;
  } catch {
    return null;
  }
}

export default async function runTargetSpec(
  projectRoot: string,
  id: string
): Promise<TargetSpecRunResult> {
  const specPath = getSpecPath(projectRoot, id);
  if (!(await pathExists(specPath))) {
    return {
      status: "missing"
    };
  }

  const outputPath = path.join(
    os.tmpdir(),
    `sail-vitest-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );
  const args = [
    "--no-install",
    "vitest",
    "run",
    path.relative(projectRoot, specPath),
    "--reporter=json",
    `--outputFile=${outputPath}`
  ];

  const result = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
    const child = spawn(getNpxCommand(), args, {
      cwd: projectRoot,
      stdio: ["ignore", "ignore", "pipe"]
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      resolve({
        code: null,
        stderr: String(error)
      });
    });

    child.on("close", (code) => {
      resolve({
        code,
        stderr
      });
    });
  });

  const jsonText = await fs.readFile(outputPath, "utf8").catch(() => "");
  await fs.unlink(outputPath).catch(() => undefined);

  if (result.code === null) {
    return {
      reason: "Vitest could not be started.",
      status: "unavailable"
    };
  }

  if (!jsonText) {
    const missingPackage = result.stderr.includes("vitest") || result.stderr.includes("npx");
    return {
      reason: missingPackage
        ? "Vitest is not available in this project."
        : "Vitest did not return a parseable result.",
      status: "unavailable"
    };
  }

  const summary = parseVitestSummary(jsonText);
  if (!summary) {
    return {
      reason: "Vitest did not return a parseable result.",
      status: "unavailable"
    };
  }

  const failed = summary.numFailedTests ?? 0;
  const passed = summary.numPassedTests ?? 0;
  const total = summary.numTotalTests ?? failed + passed;

  return {
    failed,
    passed,
    status: failed > 0 ? "failed" : "passed",
    total
  };
}
