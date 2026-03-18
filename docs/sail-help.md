# sail

sail treats a TypeScript project as a graph of named nodes, not as a pile of files to edit directly. The basic idea is simple: each file under `src/` defines exactly one public thing, and that thing is either a function, a type node, or a constant. The filename and exported symbol must match. `src/index.ts` is the special entrypoint: it exports async `main()` and runs it in `try/catch`.

Because the codebase is constrained this way, graph operations are usually more useful than raw file edits. Start with `query` to find the right node, then use `graph` to inspect structure. With no id, `graph` shows the whole project graph. With an id, it shows the graph starting from that node. Use `read` only when you want the exact source for a chosen node. Use `patch` for surgical edits and `write` for full-file replacement. Use `sail test read|write|patch <id>` for the tests that belong to one node.

When acting as an agent, do not edit files in `src/` directly. Use sail commands so the graph stays valid, writes are checked, and all actions are logged. `write` replaces an existing node file or creates a missing one at `src/<id>.ts`, so always pass a full valid TypeScript file, not a fragment or arbitrary text. `patch` edits an existing node in place, either by exact find/replace or by unified diff from stdin. Tests live beside nodes as `src/<id>.spec.ts`.

Only static local imports are allowed. Top-level executable code is not allowed except in `src/index.ts`. Run commands from the project root. Use `sail init` to bootstrap a project, and add `--force` only when you intentionally want to overwrite the starter entrypoint. After function writes and patches, sail may warn when the node looks under-tested or when its tests fail. If a write opens test debt, pay it back before the next implementation write: later node writes and patches will be blocked until tests catch up.

Every command is logged under `~/.sail`. Run `sail ui` to browse those logs locally.
