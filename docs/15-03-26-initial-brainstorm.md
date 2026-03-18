# sail: Initial Brainstorm

## Introduction
`sail` is a proposal for an AI-native TypeScript development system. The core idea is that software should not primarily be organized for human browsing through folders and large files, but for machine reasoning over a graph of routines. Instead of treating a codebase as loosely structured text, `sail` treats it as a constrained dependency graph made of small, globally addressable units.

The project starts from a simple premise: most of the context in a normal codebase is irrelevant to any given change. If agents could retrieve only the functions, types, and constants that matter for a task, they could make safer edits, produce better documentation, and operate with much stronger architectural guarantees.

The long-term vision is a system where humans work closer to intent and pseudocode, while agents maintain implementation details, structure, and validation.

## Problem
Current codebases are optimized for human readability and historical conventions rather than agent understanding. In practice this creates several problems:

- relevant context is hard to isolate
- prompts become bloated with unrelated files
- architectural constraints are weak or informal
- documentation drifts away from implementation
- edits are hard to validate at the right level of abstraction
- most repositories are not designed for safe multi-agent mutation

This leads to a mismatch: AI systems are asked to reason about software using file layouts, naming patterns, and architectural conventions that were invented for humans. The result is often skeuomorphic AI coding, where agents imitate human workflows instead of working through a representation designed for machine navigation.

## Solution
`sail` proposes a graph-native transpilation and tooling layer for TypeScript.

The system centers on a strict function-level architecture:

- one primary function per file
- file name equals function name
- function names are globally unique
- files may also include tightly related types and constants
- classes are avoided in favor of explicit function nodes

From this structure, the system builds a dependency graph that agents can crawl directly. An agent does not act by scanning arbitrary files and rewriting large regions of source. Instead it:

1. queries the graph
2. reads a minimal dependency bundle
3. proposes a targeted edit
4. runs compile-time and test validation
5. writes a new version only if checks pass

This makes the codebase easier to search, safer to edit, and easier to document automatically.

## Architecture
The architecture has three layers: source files, graph/indexing infrastructure, and developer-facing tools.

At the source level, the repository uses a flat or nearly flat routine-oriented structure. Entrypoints such as `page.tsx` and `route.ts` import graph nodes and compose application behavior, but most business logic lives in individually addressable routines.

At the indexing layer, each routine becomes a node in a directed dependency graph. Edges represent imports, calls, and other structural dependencies. The system should strongly encourage, and possibly enforce, DAG-like imports so that traversal is deterministic and architecture remains legible.

At the execution layer, a harness sits in front of the codebase and exposes graph-aware operations to agents and tools. This harness is responsible for retrieval, validation, versioning, and documentation generation.

The architecture should also support bootstrapping: the CLI and related tools could themselves be built in the same model, proving that the system can describe and maintain its own implementation.

## Data model
The core data model is a graph of code units.

Each node may represent:

- a function
- a type
- a constant

Each node should store at least:

- globally unique identifier or name
- source text
- dependency references
- caller references or reverse edges
- embedding vector
- version history
- validation state

This creates a hybrid file-and-database model. Source still exists as TypeScript files, because that is the compilation target and integration surface with existing apps. But the canonical machine-facing representation is a structured index over those files, potentially backed by a local database and content-addressed storage for immutable versions.

State management is intentionally constrained. Global state should be minimized or isolated to special entrypoint-oriented files. The default model is that state is created in `main`-like boundaries and most routines remain pure.

## API surface
The initial API surface can stay very small. The brainstorm suggests the following core operations:

```ts
read(id, depth)
readMain(depth)
query(q, depth, exact)
write(id, newText)
replace(id, newText)
```

These operations imply a graph-aware workflow:

- `query` resolves intent to relevant functions
- `read` returns a node plus a bounded dependency neighborhood
- `readMain` provides top-level program context
- `write` and `replace` submit edits against known nodes

A key output format is the single-file context bundle: a compact artifact that contains the target function plus the exact supporting routines needed to reason about it. This becomes the main context object passed to agents.

An audit log should record all retrieval and mutation operations so agent behavior is inspectable.

## Developer tools
The system likely needs three developer-facing products.

First, a CLI for project management, graph generation, compilation, validation, and agent tooling. This is the main operational interface for local development and the natural place to manage project rules.

Second, a repository layer that stores indexed routines, embeddings, dependencies, and versions. For the MVP this could be a local database plus the TypeScript source tree.

Third, a GUI or IDE that visualizes:

- the function graph
- active agent work
- retrieved context
- staleness and validation state
- architectural drift
- test cases and behavior traces

This toolset also enables automatic pseudocode and system documentation generation. By traversing the graph from entrypoints, the system can describe behavior such as routes, handlers, and startup flows with far less manual documentation effort.

## Evaluation methods
The project should be evaluated both as a programming model and as an agent-safety system.

Useful evaluation methods include:

- context efficiency: measure how many files or nodes are actually needed to solve a task in a large codebase
- retrieval quality: test whether embeddings and graph traversal find the right routines for a change request
- edit safety: track how often compile-time validation rejects bad edits before write
- architectural integrity: detect cycles, DRY violations, reconciliation loops, and documentation drift
- documentation quality: compare generated pseudocode summaries against actual system behavior
- agent productivity: compare task completion quality and cost against conventional repository layouts

An especially important experiment is to test the hypothesis that only a very small fraction of a large codebase is relevant to any given issue. If true, that validates the central promise of `sail`: software can be structured so that agents retrieve minimal, high-relevance context instead of navigating whole repositories.

## MVP direction
A practical MVP could include:

- local database-backed indexing
- TypeScript compilation through `pnpm`
- basic graph query and read operations
- compile-and-test validation on write
- an agent tool capable of making small but meaningful UI or behavior edits

That would be enough to test the most important claim: that a codebase designed as a graph of routines can be easier for agents to understand, mutate, and document than a conventional TypeScript project.