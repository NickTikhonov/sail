# MVP Spec

## Goal
This document defines the lean MVP for the TypeScript graph CLI.

The MVP should:

- index a TypeScript project under `src/`
- enforce a strict file-level data model
- build a local dependency graph from static imports
- expose a minimal CLI for `read`, `write`, `query`, and `graph`
- log every command to a per-project JSONL audit log under `~/.sail`

This spec is intentionally narrow. It is the implementation baseline, not the long-term vision.

## Non-goals
The MVP does not include:

- embeddings or semantic search
- IDE integration
- incremental compilation daemons
- multi-agent coordination
- test orchestration
- deployment workflows
- databases as a required dependency

## Runtime and language
- runtime: Node.js
- language: TypeScript
- compiler: pinned current stable `typescript`
- AST and source inspection: `ts-morph`

The CLI should use `ts-morph` as the main abstraction layer and rely on `typescript` as the authoritative compiler and diagnostics engine.

## Local developer installation
The MVP must be easy to iterate on locally with AI models and shell workflows.

That means the CLI must be installable in a way that makes the `sail` command available on the user's `PATH`.

### Requirement
The project must provide a single local developer command that:

- recompiles the CLI
- refreshes the linked executable
- leaves `sail` immediately runnable from any shell on the machine

In other words, after running one rebuild command, the developer should be able to invoke:

```sh
sail ...
```

without manually copying binaries, editing shell config, or re-linking by hand.

### Intent
This is an explicit MVP requirement because the fastest feedback loop is to let a human or AI model modify the CLI, run one command, and immediately call the updated executable from the terminal.

## Project shape
The CLI is invoked from the project root.

The project root must contain:

- `src/`

All indexed code for the MVP lives under `src/`.

## Source model

### Core rules
- every indexed file in `src/` is exactly one node
- every indexed file has exactly one default export
- filename equals exported symbol name
- allowed node kinds are:
  - function
  - type
  - const
- no file may export multiple public symbols
- only static imports are allowed
- only local project imports are indexed
- no top-level executable code is allowed except in `src/index.ts`

### Special entrypoint
`src/index.ts` is special.

It must:

- default export a single async function named `main`
- invoke `main()` in the same file
- wrap that invocation in local `try/catch`

This is the only required program entrypoint in the MVP.

### Examples

```ts
// src/getUser.ts
export default async function getUser(id: string) {
  return { id };
}
```

```ts
// src/User.ts
type User = {
  id: string;
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
  console.log("ok");
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
```

## Node model
Each indexed file becomes one graph node.

Each node has at least:

- `id`: symbol name derived from filename
- `kind`: `function`, `type`, `const`, or `main`
- `path`: path under `src/`
- `source`: full file contents
- `imports`: direct outgoing dependencies
- `importedBy`: direct reverse dependencies

The node id is the primary identifier used by the CLI.

## Graph model
The project graph is a directed graph of local static imports between nodes in `src/`.

For the MVP:

- one file equals one node
- one local static import edge equals one directed dependency
- reverse edges are derived by indexing all outgoing imports
- traversal depth is measured in import hops

The graph is held in memory and rebuilt on demand. No persistent database is required in v1.

## Validation rules
The CLI is the enforcement point for the source model.

For the MVP, it must validate:

- the current working directory contains `src/`
- `src/index.ts` exists
- `src/index.ts` default-exports async `main`
- `src/index.ts` invokes `main()` inside local `try/catch`
- each indexed file parses as valid TypeScript
- each indexed file has exactly one default export
- the exported symbol name matches the filename
- the node kind is allowed
- local imports resolve to indexed project files
- only static imports are used
- `~/.sail` runtime state can be created and written to

Anything outside these rules is out of scope for the MVP.

## CLI surface
The CLI is invoked from the project root.

Base form:

```sh
sail <command> [args] [flags]
```

The MVP has four commands:

- `read`
- `write`
- `query`
- `graph`

## Command: `read`
Reads a node and prints a local context bundle.

### Usage
```sh
sail read <id> [--depth <n>] [--revdepth <n>]
```

### Semantics
- resolves `<id>` to a node
- includes the node source itself
- expands forward dependencies up to `depth`
- expands reverse dependencies up to `revdepth`

### Defaults
- `depth = 0`
- `revdepth = 0`

### Output
Plain text only.

Each returned file is printed in full, with a one-line filename comment above it.

Example shape:

```ts
// src/getUser.ts
export default async function getUser(id: string) {
  return { id };
}

// src/User.ts
type User = {
  id: string;
};

export default User;
```

## Command: `write`
Replaces the full contents of an existing node file.

### Usage
```sh
sail write <id>
```

### Semantics
- resolves `<id>` to a node
- reads replacement file contents from stdin
- validates the new contents against the source model
- writes the file if validation passes
- rebuilds or refreshes the graph after the write

### Output
Plain text only.

Example:

```sh
echo "..." | sail write getUser
```

Patch-based mutation is out of scope for the MVP. `write` is full-file replacement only.

## Command: `query`
Finds nodes by id or simple text match.

### Usage
```sh
sail query <term> [--exact]
```

### Semantics
- `--exact` matches node id exactly
- without `--exact`, matches against:
  - filename
  - exported symbol name
  - source text

### Output
Plain text only.

One result per line:

```text
<id> <kind> <path>
```

## Command: `graph`
Prints graph structure for a node.

### Usage
```sh
sail graph [id] [--depth <n>] [--reverse]
```

### Semantics
- with no `id`, prints the full project graph
- with an `id`, traverses the graph starting from that node
- by default, traverses outgoing dependency edges
- `--depth` bounds traversal depth
- `--reverse` traverses reverse edges instead of outgoing edges

### Output
Plain text only.

Render the graph as a multi-indented list.

Example shape:

```text
getUser
  User
  MAX_RETRIES
  fetchUserRecord
    dbClient
```

## Logging and runtime state
The CLI must maintain runtime state under:

```text
~/.sail
```

This state is used for append-only audit logging and full graph snapshots.

### Directory layout

```text
~/.sail/
  projects.jsonl
  logs/
    <cwd-hash>.jsonl
  graphs/
    <cwd-hash>/
      <timestamp>.json
```

`projects.jsonl` maps known project working directories to stable hashed ids.

Each project log file is keyed by a hash of the absolute working directory path.

## Log event model
Every CLI invocation appends exactly one JSON object to the project log as a JSONL line.

Each event should contain:

- timestamp
- working directory
- cwd hash
- command
- argv
- parsed flags
- stdin payload, if any
- stdout text
- stderr text
- exit code
- duration in milliseconds
- graph summary after command completion

### Graph summary fields
Each log event must include:

- node count
- edge count
- graph hash
- touched node ids, if known

### Full graph snapshots
The CLI should write a full graph snapshot as a separate JSON file whenever the graph may have changed materially.

For the MVP, this means:

- after `write`
- after any future node create/delete command

Writing a full graph snapshot after `graph` is optional and not required in v1.

## Implementation choices

### Required dependencies
- `typescript`
- `ts-morph`

### Standard library usage
- Node.js filesystem APIs for scanning `src/`, reading stdin, writing files, and maintaining `~/.sail`
- Node.js path utilities for project-relative resolution
- a simple hash function implementation for `cwdHash` and `graphHash`

### Packaging requirement
The CLI package must expose an executable entry so it can be linked onto `PATH` for local development.

The exact implementation can vary, but the MVP should be designed around a one-command rebuild-and-link workflow, such as a package script that performs build output refresh plus local linking.

### Internal data structures
The MVP can use:

- `Map<NodeId, Node>` for nodes
- `Map<NodeId, Set<NodeId>>` for outgoing edges
- `Map<NodeId, Set<NodeId>>` for reverse edges

This is enough for:

- graph traversal
- node lookup
- graph summaries
- logging touched nodes

### Not required in v1
- `dependency-cruiser`
- `madge`
- OXC
- Tree-sitter
- `ast-grep`
- a database

These may become useful later, but they should not be core dependencies for the MVP.

## Indexing flow
Before serving a command, the CLI should:

1. discover `.ts` files under `src/`
2. create a `ts-morph` project
3. load all indexed files
4. parse each file
5. validate the source model
6. classify each node
7. extract local static imports
8. build outgoing and reverse edges
9. compute graph summary fields

## Command flow

### `read`
1. build or refresh the index
2. resolve the requested id
3. traverse forward and reverse neighborhoods
4. print bundled source files in plain text
5. write a log event

### `write`
1. build or refresh the index
2. resolve the requested id
3. read replacement source from stdin
4. validate replacement contents
5. write the file
6. rebuild or refresh the graph
7. write a graph snapshot
8. print result text
9. write a log event

### `query`
1. build or refresh the index
2. match ids and source text
3. print one line per result
4. write a log event

### `graph`
1. build or refresh the index
2. resolve the requested id
3. traverse the selected edge direction
4. print an indented graph
5. write a log event

## Acceptance criteria
The MVP is complete when:

- it can parse a project under `src/`
- it rejects files that violate the one-node, one-default-export model
- it identifies node kind correctly for function, type, const, and `main`
- it resolves local static imports into a graph
- `read`, `write`, `query`, and `graph` work from the project root
- `read` prints bundled files in the specified text format
- `graph` prints an indented text graph
- `write` reads from stdin and revalidates the project
- every command writes one JSONL audit event
- mutating commands write full graph snapshots under `~/.sail`
- one local developer command rebuilds the CLI and leaves `sail` immediately available on `PATH`

## Bottom line
The MVP is a strict TypeScript CLI built on `ts-morph` and `typescript`, with:

- one-node-per-file source rules
- a simple in-memory import graph
- four text-first commands
- append-only per-project JSONL logging
- full graph snapshots after mutations

That is the leanest version that still tests the core thesis: a constrained graph-native codebase can be parsed, validated, traversed, and safely mutated with a small tool surface.
