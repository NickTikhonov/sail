import { Command } from "commander";
import process from "node:process";
import SailError from "./lib/SailError.js";
import logCommandEvent from "./lib/logCommandEvent.js";
import readSailHelp from "./lib/readSailHelp.js";
import runCommand from "./lib/runCommand.js";
import startUiServer from "./lib/startUiServer.js";

type FlagRecord = Record<string, unknown>;

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return "";
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function executeWithLogging(input: {
  argv: string[];
  command: string;
  expectsStdin: boolean;
  flags: FlagRecord;
  run: (stdin: string) => Promise<Awaited<ReturnType<typeof runCommand>>>;
}): Promise<void> {
  const startedAt = Date.now();
  const stdin = input.expectsStdin ? await readStdin() : null;

  try {
    const result = await input.run(stdin ?? "");
    if (result.stdout) {
      process.stdout.write(`${result.stdout}\n`);
    }
    if (result.stderr) {
      process.stderr.write(`${result.stderr}\n`);
    }

    await logCommandEvent({
      argv: input.argv,
      command: input.command,
      durationMs: Date.now() - startedAt,
      exitCode: 0,
      flags: input.flags,
      projectState: result.projectState,
      quality: result.quality,
      stderr: result.stderr,
      stdin,
      stdout: result.stdout,
      touchedNodes: result.touchedNodes,
      writeSnapshot: result.shouldWriteSnapshot
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);

    try {
      const result = await runCommand({
        command: "query",
        exact: true,
        projectRoot: process.cwd(),
        term: "__nonexistent__"
      });

      await logCommandEvent({
        argv: input.argv,
        command: input.command,
        durationMs: Date.now() - startedAt,
        exitCode: error instanceof SailError ? error.exitCode : 1,
        flags: input.flags,
        projectState: result.projectState,
        stderr: message,
        stdin,
        stdout: "",
        touchedNodes: [],
        writeSnapshot: false
      });
    } catch {
      // Best-effort logging only; setup failures should not mask the original error.
    }

    process.exitCode = error instanceof SailError ? error.exitCode : 1;
  }
}

const program = new Command();

program
  .name("sail")
  .description("sail graph CLI MVP")
  .showHelpAfterError('Run "sail help" to see the project rules and valid command shapes.');

program
  .command("init")
  .summary("Bootstrap a new sail project")
  .description("Create the minimal files needed for a fresh sail TypeScript project.")
  .argument("[projectName]")
  .option("--force", "Overwrite existing bootstrap files if they already exist", false)
  .action(async (projectName: string | undefined, options: { force: boolean }) => {
    await executeWithLogging({
      argv: projectName ? [projectName] : [],
      command: "init",
      expectsStdin: false,
      flags: options,
      run: async () =>
        runCommand({
          command: "init",
          force: options.force,
          projectName,
          projectRoot: process.cwd()
        })
    });
  });

program
  .command("ui")
  .summary("Start interactive session browser")
  .description("Start a tiny local web UI for browsing sail projects, events, and graph snapshots.")
  .option("--port <n>", "Preferred local port for the UI server", "8888")
  .action(async (options: { port: string }) => {
    const url = await startUiServer(Number(options.port));
    process.stdout.write(`sail UI running at ${url}\n`);
  });

program
  .command("read")
  .summary("Print a node and nearby context")
  .description(
    "Read one node and optionally expand through its dependencies and reverse dependencies. depth follows import hops used by this node. revdepth follows nodes that depend on this node."
  )
  .argument("<id>")
  .option("--depth <n>", "How many import hops to follow through dependencies", "0")
  .option("--revdepth <n>", "How many reverse hops to follow through dependents", "0")
  .action(async (id: string, options: { depth: string; revdepth: string }) => {
    await executeWithLogging({
      argv: [id],
      command: "read",
      expectsStdin: false,
      flags: options,
      run: async () =>
        runCommand({
          command: "read",
          depth: Number(options.depth),
          id,
          projectRoot: process.cwd(),
          revdepth: Number(options.revdepth)
        })
    });
  });

program
  .command("write")
  .summary("Create or replace a node")
  .description(
    "Create a missing node or replace an existing node with a full valid TypeScript file from stdin."
  )
  .argument("<id>")
  .action(async (id: string) => {
    await executeWithLogging({
      argv: [id],
      command: "write",
      expectsStdin: true,
      flags: {},
      run: async (stdin) =>
        runCommand({
          command: "write",
          id,
          projectRoot: process.cwd(),
          stdin
        })
    });
  });

program
  .command("patch")
  .summary("Edit an existing node surgically")
  .description(
    "Patch an existing node either by exact text replacement or by applying a unified diff from stdin."
  )
  .argument("<id>")
  .option("--find <text>", "Exact text to replace")
  .option("--replace <text>", "Replacement text for exact patch mode")
  .option("--diff", "Read a unified diff for this node from stdin", false)
  .action(
    async (
      id: string,
      options: { diff: boolean; find?: string; replace?: string }
    ) => {
      await executeWithLogging({
        argv: [id],
        command: "patch",
        expectsStdin: options.diff,
        flags: options,
        run: async (stdin) =>
          runCommand({
            command: "patch",
            diff: options.diff,
            find: options.find,
            id,
            projectRoot: process.cwd(),
            replace: options.replace,
            stdin
          })
      });
    }
  );

const testCommand = program
  .command("test")
  .summary("Work with node tests")
  .description("Read, write, or patch colocated Vitest specs for one node at a time.");

testCommand
  .command("read")
  .summary("Print a node test")
  .description("Read the spec that belongs to one node.")
  .argument("<id>")
  .action(async (id: string) => {
    await executeWithLogging({
      argv: ["read", id],
      command: "test",
      expectsStdin: false,
      flags: {},
      run: async () =>
        runCommand({
          command: "test-read",
          id,
          projectRoot: process.cwd()
        })
    });
  });

testCommand
  .command("write")
  .summary("Create or replace a node test")
  .description("Create a missing spec or replace an existing spec for one node from stdin.")
  .argument("<id>")
  .action(async (id: string) => {
    await executeWithLogging({
      argv: ["write", id],
      command: "test",
      expectsStdin: true,
      flags: {},
      run: async (stdin) =>
        runCommand({
          command: "test-write",
          id,
          projectRoot: process.cwd(),
          stdin
        })
    });
  });

testCommand
  .command("patch")
  .summary("Edit a node test surgically")
  .description("Patch one node spec either by exact text replacement or by applying a unified diff from stdin.")
  .argument("<id>")
  .option("--find <text>", "Exact text to replace")
  .option("--replace <text>", "Replacement text for exact patch mode")
  .option("--diff", "Read a unified diff for this node test from stdin", false)
  .action(
    async (
      id: string,
      options: { diff: boolean; find?: string; replace?: string }
    ) => {
      await executeWithLogging({
        argv: ["patch", id],
        command: "test",
        expectsStdin: options.diff,
        flags: options,
        run: async (stdin) =>
          runCommand({
            command: "test-patch",
            diff: options.diff,
            find: options.find,
            id,
            projectRoot: process.cwd(),
            replace: options.replace,
            stdin
          })
      });
    }
  );

program
  .command("query")
  .summary("Find nodes by id or text")
  .description("Search nodes by exact id or by simple text matches across ids, paths, and source.")
  .argument("<term>")
  .option("--exact", "Match node id exactly", false)
  .action(async (term: string, options: { exact: boolean }) => {
    await executeWithLogging({
      argv: [term],
      command: "query",
      expectsStdin: false,
      flags: options,
      run: async () =>
        runCommand({
          command: "query",
          exact: options.exact,
          projectRoot: process.cwd(),
          term
        })
    });
  });

program
  .command("graph")
  .summary("Print the dependency graph")
  .description(
    "Print the whole project graph, or start from one node and traverse dependencies or dependents. With no id, graph prints the whole project graph. By default, traversal follows imports used by a node. --reverse follows nodes that depend on the selected node, then the nodes that depend on those nodes."
  )
  .argument("[id]")
  .option("--depth <n>", "How many hops to traverse through the graph")
  .option("--reverse", "Traverse dependents instead of imports", false)
  .action(async (id: string | undefined, options: { depth?: string; reverse: boolean }) => {
    await executeWithLogging({
      argv: id ? [id] : [],
      command: "graph",
      expectsStdin: false,
      flags: options,
      run: async () =>
        runCommand({
          command: "graph",
          depth: options.depth ? Number(options.depth) : Number.POSITIVE_INFINITY,
          id,
          projectRoot: process.cwd(),
          reverse: options.reverse
        })
    });
  });

async function main(): Promise<void> {
  const helpPreamble = await readSailHelp();
  program.helpInformation = function helpInformation(): string {
    return `${helpPreamble}\n\n${Command.prototype.helpInformation.call(this)}`;
  };
  await program.parseAsync(process.argv);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = error instanceof SailError ? error.exitCode : 1;
});
