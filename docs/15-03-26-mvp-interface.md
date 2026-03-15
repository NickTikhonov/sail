# Lean MVP Interface

## TypeScript runtime target
The MVP runs on a current stable version of TypeScript. The exact version can be pinned by the CLI, but the interface assumes:

- modern ESM-style TypeScript
- async/await support
- default exports
- file-based module resolution within `src/`

## Source model
All source files live under `src/`.

### Core rules
- every file in `src/` represents exactly one node
- every file has exactly one default export
- the filename must match the exported symbol name
- exports may be only one of:
  - function
  - type
  - constant
- no file may export multiple public symbols

### Special entrypoint
`src/index.ts` is special.

It must define and default export a single async function named `main`.

The file is also responsible for invoking `main()` inside a local `try/catch` block so the program can be run directly.

This is the only required entrypoint in the MVP.

### Example shape

```ts
// src/getUser.ts
export default async function getUser(id: string) {
  // ...
}
```

```ts
// src/User.ts
type User = {
  id: string;
  name: string;
};

export default User;
```

```ts
// src/MAX_RETRIES.ts
const MAX_RETRIES = 3;

export default MAX_RETRIES;
```

```ts
// src/index.ts
export default async function main() {
  // ...
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
```

## Node model
The CLI treats each file as a graph node.

Each node has:

- `id`: the symbol name, derived from the filename
- `kind`: `function`, `type`, `const`, or `main`
- `path`: file path under `src/`
- `source`: raw file contents
- `imports`: direct dependencies
- `importedBy`: direct reverse dependencies

For the MVP, this index can be derived entirely from the filesystem and TypeScript parsing. No database is required.

## Graph model
The graph is a directed graph of imports between nodes in `src/`.

For the MVP:

- only static imports are allowed
- edges are created from static imports only
- only local project imports are indexed
- graph depth is measured by import hops
- reverse edges are computed by the CLI during indexing

This is enough to support neighborhood retrieval and simple dependency inspection.

## CLI design
The CLI is invoked from the project root.

Base form:

```sh
agentscript <command> [args] [flags]
```

The MVP surface should stay as small as possible. A lean first version can have four commands:

- `read`
- `write`
- `query`
- `graph`

## Command: `read`
Reads a node and returns its local context bundle.

### Usage
```sh
agentscript read <id> [--depth <n>] [--revdepth <n>]
```

### Behavior
- resolves `<id>` to `src/<id>.ts`
- returns the node source
- optionally expands to imported dependencies up to `depth`
- optionally expands to imported reverse dependencies up to `revdepth`

### MVP default
- default depth is `0`
- default revdepth is `0`

### Example
```sh
agentscript read getUser --depth 1 --revdepth 1
```

### Output
`read` prints plain text only.

When a single node or bundle is returned, each file is printed in full with a one-line filename comment above it.

Example shape:

```ts
// src/getUser.ts
export default async function getUser(id: string) {
  // ...
}

// src/User.ts
type User = {
  id: string;
  name: string;
};

export default User;
```

## Command: `write`
Replaces the full contents of a node file.

### Usage
```sh
agentscript write <id>
```

### Behavior
- resolves `<id>` to `src/<id>.ts`
- reads replacement contents from stdin
- overwrites the target file if validation passes

### Validation rules
- there is exactly one default export
- the exported symbol name matches the filename
- the node kind is allowed

### Example
```sh
echo "..." | agentscript write getUser
```

## Command: `query`
Finds nodes by exact id or simple text match.

### Usage
```sh
agentscript query <term> [--exact]
```

### Behavior
- with `--exact`, matches node id exactly
- without `--exact`, matches against:
  - filename
  - exported symbol name
  - source text

### Example
```sh
agentscript query user
agentscript query getUser --exact
```

This keeps query usable before embeddings or semantic search exist.

### Output
`query` prints plain text only.

Each result should be rendered as a single line. The leanest useful format is:

```text
<id> <kind> <path>
```

## Command: `graph`
Returns structural graph information for a node.

### Usage
```sh
agentscript graph <id> [--depth <n>] [--reverse]
```

### Behavior
- returns direct imports by default
- expands dependency traversal with `--depth`
- returns callers instead when `--reverse` is supplied

### Example
```sh
agentscript graph getUser --depth 2
agentscript graph getUser --reverse
```

This command is intentionally separate from `read` so users can inspect structure without reading full source bundles.

## Output format
For the MVP, the CLI outputs plain text only.

`read` prints full file contents, with each file preceded by a one-line filename comment.

`graph` prints a multi-indented list.

Example shape:

```text
getUser
  User
  MAX_RETRIES
  fetchUserRecord
    dbClient
```

`query` prints one result per line.

## Runtime state and logging
The MVP should maintain a well-known local state directory at `~/.agentscript`.

This directory is used for append-only command logs and graph snapshots.

### Goals
- make every CLI action traceable
- support analytics across real usage
- make project graph state easy to debug
- keep logging simple enough for the MVP

### Directory layout
A lean initial layout can be:

```text
~/.agentscript/
  projects.jsonl
  logs/
    <cwd-hash>.jsonl
  graphs/
    <cwd-hash>/
      <timestamp>.json
```

`projects.jsonl` maps known project working directories to their stable hashed ids.

Each project log file is keyed by a hash of the absolute working directory path, rather than using the raw path directly as a filename.

### Log model
Each CLI invocation appends exactly one JSON object to the project log file as a JSONL line.

Each log line should contain:

- timestamp
- working directory
- cwd hash
- command name
- argv
- parsed flags
- stdin payload, if any
- stdout text
- stderr text
- exit code
- duration in milliseconds
- graph summary after command completion

### Graph summary
Every log line should include a lightweight graph summary after the command completes.

The summary should contain:

- node count
- edge count
- graph hash
- touched node ids, if known

This gives the CLI a stable audit trail without duplicating the entire graph on every command.

### Full graph snapshots
The CLI should also write a full graph snapshot as a separate JSON file when the graph may have changed materially.

For the MVP, this should happen after:

- `write`
- any future command that creates or deletes nodes

It may also happen after explicit `graph` commands if that proves useful, but it is not required for the first version.

### Example log event
```json
{
  "ts": "2026-03-15T12:34:56.000Z",
  "cwd": "/Users/nick/Documents/Code/agentscript",
  "cwdHash": "abc123",
  "command": "write",
  "argv": ["getUser"],
  "flags": {},
  "stdin": "export default async function getUser(id: string) { return null; }",
  "stdout": "wrote src/getUser.ts",
  "stderr": "",
  "exitCode": 0,
  "durationMs": 42,
  "graph": {
    "nodeCount": 18,
    "edgeCount": 27,
    "graphHash": "def456",
    "touchedNodes": ["getUser"]
  }
}
```

### Logging policy
For the MVP, logging should be on by default and treated as part of the CLI contract.

The simplest rule is:

- every command produces one log event
- mutating commands also produce a full graph snapshot

This keeps the system observable from day one and gives a clean base for later analytics work.

## Validation model
The CLI is the control surface for the data model.

For the MVP, it should validate:

- project root contains `src/`
- `src/index.ts` exists
- `src/index.ts` default-exports async `main`
- all indexed files contain exactly one default export
- filename matches exported symbol name
- indexed imports resolve inside the project when they target local nodes
- `~/.agentscript` state can be initialized and written to

Anything outside these rules is out of scope for the first version.

## Lean MVP summary
The minimum viable interface is:

```sh
agentscript read <id> [--depth <n>] [--revdepth <n>]
agentscript write <id>
agentscript query <term> [--exact]
agentscript graph <id> [--depth <n>] [--reverse]
```

And the minimum viable source model is:

- all code lives in `src/`
- one file equals one node
- one file equals one default export
- filename equals symbol name
- allowed node kinds are function, type, and const
- `src/index.ts` is the special async `main` entrypoint and runs itself in `try/catch`

And the minimum viable runtime model is:

- CLI state lives under `~/.agentscript`
- each project has a per-working-directory JSONL log
- each command writes one structured log event
- each log event includes a graph summary
- mutating commands also write a full graph snapshot

That is enough to build and test the first graph-aware implementation without committing yet to databases, embeddings, richer mutation semantics, or a broader programming model.
