# sail

`sail` is an IDE built for agents, not humans.

AI coding usually breaks down for the same reason human teams do: the codebase gets noisy, inconsistent, and hard to navigate. `sail` fixes that by exposing an agent-first interface that gives models the right context at the right time and enforces good standards on every write. The result is a more predictable, more scalable codebase that agents can keep working in without drifting into chaos.

## Quick Start

```sh
npm install -g sail
sail init my-app
cd my-app
claude "build me a reddit CLI"
```

## What It Is

`sail` gives agents a development environment that is designed around structure, constraint, and fast feedback.

Instead of exposing a free-for-all filesystem, `sail` gives the agent a tighter interface for exploring code, making changes, and getting immediate feedback when it starts to drift. That makes it easier to keep an AI-driven project coherent as it grows.

## How sail works

`sail` organizes a TypeScript project as a graph of named nodes. Agents explore that graph through commands like `query`, `read`, and `graph`, then make changes through `write`, `patch`, and test commands instead of editing files directly. Every mutation is checked by the tool, so structure, validation, and test expectations are enforced as the project evolves.

## Why use Sail

- Agents get the right context at the right time instead of scanning broad file trees.
- Important rules live in tooling, not just in prompts that models can forget.
- All written code is validated immediately, so bad changes fail fast.
- The codebase stays more predictable and structured as it grows.
- You get better results from AI without constantly cleaning up architectural drift.
