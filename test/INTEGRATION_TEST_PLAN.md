# Integration Test Plan

This suite exercises `sail` as a real CLI in temporary project directories with an isolated `HOME`, so command logs and graph snapshots do not leak into the developer's real `~/.sail`.

## Green Paths

- `init` defaults `graphSrc` to `src/sail` when `src/` already exists.
- `init` defaults `graphSrc` to `sail` when `src/` does not exist.
- `help` explains `sail.config.json`, `graphSrc`, and test commands.
- `write` can create a new node file under the configured graph root.
- `test write` can create a colocated spec under the configured graph root.
- `graph` renders forward dependencies.
- `graph --reverse` renders reverse dependencies.

## UX And Workflow Constraints

- `write` without stdin fails with a clear full-file guidance message.
- The first function write can succeed while opening test debt.
- Open test debt blocks the next implementation write.
- A test write pays back debt enough to unblock later implementation writes.

## Core Invariants

- No named exports beyond the single default export.
- No top-level executable statements outside `<graphSrc>/index.ts`.
- Filename and exported symbol must match.
- `index.ts` must default-export async `main`.
- `index.ts` must invoke `main()` inside local `try/catch`.
- Only static local imports are allowed.
- Local imports must resolve within the configured graph root.

## Future Backlog

- `read --depth` and `--revdepth` neighborhood expansion.
- Full graph rendering with multiple roots and shared dependencies.
- Cycle rendering and collapse markers.
- Malformed `sail.config.json` and invalid `graphSrc` path cases.
- Orphan spec detection and test patch flows.
- Failing and unavailable Vitest execution warnings.
