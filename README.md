# sail

`sail` is an IDE built for agents, not humans.

AI coding usually breaks down for the same reason human teams do: the codebase gets noisy, inconsistent, and hard to navigate. `sail` fixes that by exposing an **agent-first interface** that gives models the right context at the right time and enforces good standards on every write. The result is a **more predictable, more scalable codebase** that agents can keep working in without drifting into chaos.

## Quick Start 🚀

### Web Apps 🌐
React apps, Next.js apps, and other browser-based projects.

```sh
npx create-react-app my-app
cd my-app
sail init
claude "build me a chess game with AI player support"
```

### Standalone Apps 🛠️
Scripts, CLIs, and other non-web TypeScript projects.

```sh
npm install -g sail
sail init my-app
cd my-app
claude "build me a reddit CLI"
```

## What It Is ✨

`sail` gives agents a development environment designed around **structure, constraint, and fast feedback**.

Instead of exposing a free-for-all filesystem, `sail` gives the agent a tighter interface for exploring code, making changes, and getting immediate feedback when it starts to drift. That makes it easier to keep an AI-driven project coherent as it grows.

### Some Awesome Things Sail Does

- 🧭 Gives your agent an easy way to trace all dependencies and usages of any piece of code it writes, so it can manage context without getting lost.
- ✅ Does a compile and type check on every agent edit, giving your agent immediate feedback on broken imports, bad types, and invalid code. No more silently broken projects.
- 🧪 Forces your agents to write an appropriate number of tests for every file right after making writes or edits, instead of leaving the test suite as "future work."
- 🧱 Keeps your public boundaries clean, so agents do not slowly turn your app into a bowl of spaghetti.

Sail guides your agent towards writing quality code by default:

<img width="840" height="537" alt="Screenshot 2026-03-18 at 15 32 24" src="https://github.com/user-attachments/assets/760007d5-4091-4437-902b-34ab2afc88cd" />

Sail blocks your agent when it breaks conventions. Tech debt must be paid immediately!

<img width="844" height="618" alt="Screenshot 2026-03-18 at 15 27 11" src="https://github.com/user-attachments/assets/3cd95dbd-5733-46a8-b2a2-ad92d5c5aa55" />

## How Sail Works ⚙️

`sail` organizes a TypeScript project as a graph of named nodes. Agents explore that graph through commands like `query`, `read`, and `graph`, then make changes through `write`, `patch`, and test commands instead of editing files directly. Every mutation is checked by the tool, so structure, validation, and test expectations are enforced as the project evolves.

## Why Use Sail 🧠

- Agents get the right context at the right time instead of scanning broad file trees.
- Important rules live in tooling, not just in prompts that models can forget.
- All written code is validated immediately, so bad changes fail fast.
- The codebase stays more predictable and structured as it grows.
- You get better results from AI without constantly cleaning up architectural drift.
