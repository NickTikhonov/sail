# MVP Tech Research

## Goal
This document recommends a practical technology stack for the lean MVP.

The MVP needs to:

- parse each file under `src/`
- verify that each file is valid TypeScript
- verify that each file matches the project export rules
- extract imports and build a dependency graph
- support graph traversal for `read`, `query`, and `graph`

The recommendations below are based on current tool options researched via Perplexity and then narrowed to the simplest stack that fits the current design.

## What the MVP actually needs
The MVP does not need a full build system, IDE plugin, or advanced static analysis engine yet.

It needs four concrete capabilities:

1. parse TypeScript reliably
2. inspect the default export of each file
3. resolve local imports between files in `src/`
4. store and traverse the resulting graph in memory

That means the best stack is probably not the most powerful or the fastest possible stack. It is the one with the lowest implementation risk while still giving correct TypeScript behavior.

## Recommended stack

### 1. Parser and source inspection: `ts-morph`
Best choice for the MVP: `ts-morph`

Why:

- it wraps the TypeScript Compiler API with a much friendlier interface
- it can parse source files, walk the AST, inspect imports and exports, and access symbol/type information
- it reduces a lot of boilerplate compared to using raw `typescript`
- it is well suited to building custom analysis and refactoring tools

For this project, `ts-morph` is a strong fit because the CLI needs to answer questions like:

- does this file parse?
- what is the default export?
- is the default export a function, type alias, interface-like type construct, or constant?
- what files does this node import?

This is exactly the kind of programmatic code inspection `ts-morph` is designed for.

### 2. Canonical compiler behavior: `typescript`
Best choice for the MVP: use the `typescript` package alongside `ts-morph`

Why:

- `ts-morph` is built on top of the TypeScript compiler
- the project should still depend directly on `typescript` so the CLI is pinned to a specific compiler version
- if the MVP later needs lower-level control over diagnostics, module resolution, or syntax kinds, the raw compiler API is already available

In practice, the simplest implementation is to use `ts-morph` as the main interface and treat `typescript` as the underlying engine.

### 3. Dependency graph storage and traversal: custom in-memory graph
Best choice for the MVP: build a small custom graph layer

Why:

- the graph model is simple: nodes are files, edges are local static imports
- traversal needs are simple: forward depth, reverse depth, and text rendering
- a custom graph is easier to shape around your exact CLI semantics than integrating a general-purpose graph product

The in-memory model can be as small as:

- `Map<NodeId, Node>`
- `Map<NodeId, Set<NodeId>>` for outgoing edges
- `Map<NodeId, Set<NodeId>>` for reverse edges

That is enough to support:

- `read <id> --depth n --revdepth n`
- `graph --depth n`
- `graph <id> --depth n`
- `graph <id> --reverse`
- graph summaries for logging

### 4. Validation of dependency rules: custom first, `dependency-cruiser` later
Best choice for the MVP: custom validation in the CLI

Why:

- your current rules are unusually specific
- the MVP only needs to validate one default export, filename-symbol matching, special `src/index.ts`, and local static imports
- these checks are easy to express directly once the files are parsed

`dependency-cruiser` looks valuable later, especially if you want configurable architectural rules, cycle detection policies, or reporting. But for the first version it is probably more tool than you need.

### 5. Quick graph visualization and experiments: optional `madge`
Best choice for the MVP: not required

Why:

- `madge` is useful for quick dependency graph generation and circular dependency inspection
- it is more of a convenience tool than a core runtime dependency for your CLI

If you want a quick sanity check during development, `madge` could be handy. But I would not build the CLI around it.

## Why not use only the raw TypeScript Compiler API?
You could, and it would absolutely work.

But for the MVP it would likely slow down implementation. The raw compiler API is powerful but verbose. Since your tool is fundamentally about project-specific graph semantics rather than compiler internals, `ts-morph` is a better default abstraction layer.

The rule of thumb is:

- use `ts-morph` for most project code
- drop into raw `typescript` only when you need lower-level behavior

## Why not use a faster parser like OXC?
OXC looks promising for high-performance JavaScript and TypeScript tooling, and Perplexity surfaced it as a fast modern parser.

But for this MVP, performance is probably not the bottleneck. Correct TypeScript semantics matter more than raw parse speed, because you care about:

- accurate export detection
- real TypeScript syntax support
- stable import analysis
- compatibility with the TypeScript version the project is pinned to

OXC may become attractive later if performance becomes a problem, but it adds risk for a first implementation whose main job is to be correct and easy to evolve.

## Why not use ast-grep or Tree-sitter?
These are excellent for structural code search and rule-based code matching.

They are less ideal as the primary foundation for this MVP because your tool needs to understand TypeScript modules as compilable program units, not just as syntax trees for search and rewriting. They are better complements than foundations here.

## Recommended implementation approach

### Project scanning
At startup or before each command:

1. walk all `.ts` files under `src/`
2. create a `ts-morph` project
3. load the files as source files
4. parse and index every file

### Per-file validation
For each source file:

1. confirm the file parses without syntax errors
2. confirm there is exactly one default export
3. confirm the exported symbol name matches the filename
4. classify the node as `function`, `type`, `const`, or `main`
5. extract local static imports

### Graph construction
After indexing:

1. create one node per file
2. resolve local imports to node ids
3. populate outgoing edges
4. populate reverse edges
5. compute graph summary fields such as node count, edge count, and graph hash

### Command execution
- `read`: traverse forward and reverse edges, then print bundled files
- `query`: search ids and source text in the in-memory index
- `graph`: traverse edges and render an indented tree/list
- `write`: read stdin, validate replacement source, write the file, then rebuild or refresh the index

## Concrete recommendation
If I were implementing this MVP right now, I would use:

- `typescript` for the pinned compiler and diagnostics engine
- `ts-morph` for parsing, AST access, export inspection, and import extraction
- Node.js built-in filesystem APIs for scanning `src/` and writing logs
- a small custom graph representation in application code
- a simple hash function for `cwdHash` and `graphHash`

I would not use `dependency-cruiser`, `madge`, OXC, Tree-sitter, or ast-grep as core dependencies in v1.

## Later additions
Once the MVP works, the most likely follow-on tools are:

- `dependency-cruiser` for richer dependency rules and reporting
- `madge` for fast graph visualization checks during development
- `ast-grep` for structural querying and future rewrite workflows
- a database if graph state or logs outgrow filesystem storage

## Bottom line
The leanest credible stack is:

- `typescript`
- `ts-morph`
- custom graph/index code
- filesystem-backed logs and graph snapshots

That gives you correct TypeScript parsing, export validation, dependency traversal, and enough flexibility to evolve the system without overcommitting to heavyweight tooling too early.

## Research notes
High-level takeaways from the Perplexity research:

- `ts-morph` is widely recommended as the practical developer-facing wrapper over the TypeScript Compiler API for AST traversal, symbol inspection, and code analysis
- the raw TypeScript Compiler API remains the most authoritative low-level foundation
- `dependency-cruiser` is stronger than `madge` for rule-based dependency validation
- `madge` is useful for lighter graph generation and circular dependency checks
- OXC, Tree-sitter, ast-grep, and Semgrep are relevant adjacent tools, but they are not the simplest foundation for this MVP
