import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import buildProjectState from "./buildProjectState.js";

type ProjectState = Awaited<ReturnType<typeof buildProjectState>>;

type LogEventInput = {
  argv: string[];
  command: string;
  durationMs: number;
  exitCode: number;
  flags: Record<string, unknown>;
  projectState: ProjectState;
  stderr: string;
  stdin: string | null;
  stdout: string;
  touchedNodes: string[];
  writeSnapshot: boolean;
};

function hashText(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

async function ensureFile(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, "", "utf8");
}

function buildSnapshot(projectState: ProjectState): string {
  const snapshot = {
    cwd: projectState.projectRoot,
    cwdHash: projectState.cwdHash,
    graph: {
      edgeCount: projectState.graphSummary.edgeCount,
      graphHash: projectState.graphSummary.graphHash,
      nodeCount: projectState.graphSummary.nodeCount
    },
    nodes: [...projectState.nodes.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((node) => ({
        id: node.id,
        importedBy: node.importedBy,
        imports: node.imports,
        kind: node.kind,
        path: node.pathFromRoot
      }))
  };

  return JSON.stringify(snapshot, null, 2);
}

export default async function logCommandEvent(input: LogEventInput): Promise<void> {
  const stateDir = path.join(os.homedir(), ".agentscript");
  const logsDir = path.join(stateDir, "logs");
  const graphsDir = path.join(stateDir, "graphs", input.projectState.cwdHash);
  const projectsPath = path.join(stateDir, "projects.jsonl");
  const logPath = path.join(logsDir, `${input.projectState.cwdHash}.jsonl`);

  await fs.mkdir(logsDir, { recursive: true });
  await fs.mkdir(graphsDir, { recursive: true });
  await ensureFile(projectsPath);
  await ensureFile(logPath);

  const projectLine = JSON.stringify({
    cwd: input.projectState.projectRoot,
    cwdHash: input.projectState.cwdHash
  });
  const existingProjects = await fs.readFile(projectsPath, "utf8");
  if (!existingProjects.split("\n").includes(projectLine)) {
    await fs.appendFile(projectsPath, `${projectLine}\n`, "utf8");
  }

  const event = {
    argv: input.argv,
    command: input.command,
    cwd: input.projectState.projectRoot,
    cwdHash: input.projectState.cwdHash,
    durationMs: input.durationMs,
    exitCode: input.exitCode,
    flags: input.flags,
    graph: {
      edgeCount: input.projectState.graphSummary.edgeCount,
      graphHash: input.projectState.graphSummary.graphHash,
      nodeCount: input.projectState.graphSummary.nodeCount,
      touchedNodes: input.touchedNodes
    },
    stderr: input.stderr,
    stdin: input.stdin,
    stdout: input.stdout,
    ts: new Date().toISOString()
  };

  await fs.appendFile(logPath, `${JSON.stringify(event)}\n`, "utf8");

  if (!input.writeSnapshot) {
    return;
  }

  const snapshotName = `${new Date().toISOString().replaceAll(":", "-")}-${hashText(event.stdout + event.ts)}.json`;
  await fs.writeFile(path.join(graphsDir, snapshotName), buildSnapshot(input.projectState), "utf8");
}
