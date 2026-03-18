# Immediate Test Debt Payback

## Goal

Encourage agents to write tests as part of the same local work loop, without making the very first implementation write impossible.

The core idea is:

- the implementation write that creates test debt is allowed
- once that debt exists, later implementation writes are blocked
- the next allowed mutation should be a test mutation that pays the debt back

This keeps the system practical while still strongly steering agents toward immediate testing.

## Why This Exists

A hard rule like "a function cannot be written unless its tests already exist" does not work for creation flows. A new function often has no tests yet, so the system would deadlock on the first write.

The better model is a two-step rule:

1. allow the write that creates or changes the function
2. force the next mutation work to pay back the missing tests

That gives agents a path forward while still making test debt short-lived.

## Command Classes

There are now two mutation classes.

Implementation mutations:

- `agentscript write <id>`
- `agentscript patch <id>`

Test mutations:

- `agentscript test write <id>`
- `agentscript test patch <id>`

Read-only commands stay unaffected.

## Enforcement Rule

On every implementation `write` or `patch`, AgentScript first analyzes the whole project for open test debt.

If test debt already exists anywhere in the codebase, the implementation mutation is rejected before any file changes happen.

The error points the agent at the node ids that still need tests and tells it to use `agentscript test write` or `agentscript test patch`.

Test mutations are never blocked by test debt. They are the recovery path.

## What Counts As Test Debt

For now, test debt is tracked only for function nodes.

For each function node:

1. compute a rough complexity score from the implementation AST
2. convert that into a recommended rough minimum test count
3. find the corresponding test file
4. count active unit tests in that file

If the number of tests is below the recommendation, that node has open test debt.

The matching test file is:

- `src/<id>.spec.ts`

The public surface remains node-first. User-facing warnings and blockers should refer to node ids, not filenames.

## Complexity And Test Counting

The current complexity estimate is intentionally rough. It is based on branching structure such as:

- `if`
- loops
- `catch`
- ternaries
- `switch` branching
- short-circuit boolean operators

The recommended test count is roughly:

- `max(1, complexityScore)`

Tests are counted by looking for active `it(...)` and `test(...)` calls in the node's spec.

Skipped or todo tests do not count toward the total.

## Write Flow

### Case 1: no existing debt

If the repo currently has no open test debt:

1. `agentscript write <id>` or `agentscript patch <id>` is allowed
2. the node is validated and written
3. AgentScript analyzes the whole repo again
4. if the change opened test debt, the command succeeds but warns

That warning tells the agent:

- which node is now under-tested
- how many tests were found
- how many are roughly recommended
- that the next mutation should be a test write or test patch

### Case 2: existing debt already open

If the repo already has open test debt:

1. implementation `write` and `patch` are blocked
2. the command prints the outstanding debt summary
3. the agent must use a test mutation next

## Test Mutation Flow

`agentscript test write <id>` and `agentscript test patch <id>`:

- modify the test that belongs to node `<id>`
- validate the test file
- rerun test debt analysis for the whole repo
- warn if debt still remains elsewhere

If the test mutation clears the outstanding debt, implementation writes are unlocked again.

## Whole-Repo Analysis

The debt check is repo-wide, not local to the last touched node.

This matters because the desired behavior is:

- if node `A` opened debt
- and the agent tries to write node `B`
- the system should still block that write until node `A`'s tests are handled

That is what creates the immediate payback loop.

## Logging

Mutation logs should capture test-debt metadata such as:

- total open debt count
- which node ids are under-tested
- recommended counts
- observed counts

This makes it possible to inspect not only whether a write succeeded, but also whether the project was left in a blocked state.

## Design Intent

This is not meant to prove correctness. It is a behavioral constraint for agents.

The system is trying to create a fast local rhythm:

1. write implementation
2. see debt warning
3. write or patch tests
4. continue implementation only after the debt is paid back

That rhythm is the point.
