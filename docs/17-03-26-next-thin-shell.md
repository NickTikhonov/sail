# Next.js Thin-Shell Model

## Goal

Support full-stack Next.js apps without giving up the core AgentScript model: keep most application logic as small, flat, globally addressable nodes, while letting Next.js keep its file-based routing and framework conventions.

## Core Idea

In Next.js mode, not every file needs to be a graph node.

Instead, the repo is split into two layers:

- `app/**` contains thin framework adapter files such as `page.tsx`, `layout.tsx`, `route.ts`, and other Next entry files.
- `src/nodes/**` contains the real AgentScript logic as a flat namespace of one-export-per-file nodes.

The bridge between those two layers is `src/index.ts`.

Rather than only exporting one special `main()` entrypoint, `src/index.ts` becomes the single public surface for the app. It exposes named exports for all framework-facing entrypoints: pages, route handlers, server actions, metadata generators, and other Next seams.

## Proposed Layout

- `app/**`: Next.js route files and framework-required files
- `src/nodes/**`: flat AgentScript node namespace
- `src/index.ts`: named-export surface for all public app entrypoints

Example:

```text
app/
  page.tsx
  blog/[slug]/page.tsx
  api/posts/route.ts
src/
  index.ts
  nodes/
    renderHomePage.tsx
    renderBlogPostPage.tsx
    handlePostsApi.ts
    getBlogPost.ts
    listPosts.ts
```

## How It Works

All durable app logic lives in `src/nodes/**`.

Next adapter files in `app/**` stay very small. They receive framework inputs such as `params`, `searchParams`, `Request`, or form data, and then delegate into one named export from `src/index.ts`.

`src/index.ts` re-exports the actual node implementations from `src/nodes/**`.

That means:

- Next.js still owns routing and runtime conventions.
- AgentScript still owns the logical program graph.
- There is one canonical public surface for the app.

## Entrypoint Model

In the current CLI MVP, `src/index.ts` is special because it exports `main()`.

In Next.js mode, `src/index.ts` would still be special, but in a different way:

- it exposes named exports instead of a single runtime entry
- each named export represents an approved framework entry seam
- each named export points to exactly one node file in `src/nodes/**`

Example:

```typescript
export { default as homePage } from "./nodes/renderHomePage";
export { default as blogPostPage } from "./nodes/renderBlogPostPage";
export { GET as postsApiGet, POST as postsApiPost } from "./nodes/handlePostsApi";
export { default as createPostAction } from "./nodes/createPostAction";
```

This keeps the public surface explicit and discoverable.

## Thin Adapter Rule

Files in `app/**` should be treated as framework glue, not as the main place for application logic.

They should generally only do a few things:

- receive framework inputs
- call or render one named export from `src/index.ts`
- return JSX, `Response`, or Next-specific wrappers

They should generally not contain:

- domain logic
- database logic
- fetch logic
- non-trivial transforms
- business rules

Those should live in `src/nodes/**`.

## Example Flow

`app/blog/[slug]/page.tsx` might:

- receive `params.slug`
- import `blogPostPage` from `src/index.ts`
- call it and return the result

`src/index.ts` would:

- export `blogPostPage` from `src/nodes/renderBlogPostPage.tsx`

`src/nodes/renderBlogPostPage.tsx` would:

- import `getBlogPost`
- import presentational helpers or child components
- contain the real page composition logic

## Why This Fits AgentScript

This preserves the main benefits of the model:

- business logic remains flat, named, and globally addressable
- agents can still query and traverse the real logic graph
- framework files stay small and stable
- the app has one explicit public surface in `src/index.ts`

It also fits the reality of Next.js:

- some files have to exist because the framework requires them
- those files do not need to become the center of the codebase

## Validation Direction

If this mode is implemented, validation would likely split into two rule sets.

For `src/nodes/**`:

- keep the existing AgentScript node rules as much as possible
- one public export per file
- flat namespace
- graph-safe static imports

For `app/**`:

- allow only known framework filenames and exports
- enforce that adapters import from `src/index.ts`
- enforce that adapters stay thin
- optionally warn when an adapter grows beyond a small complexity threshold

For `src/index.ts`:

- allow named exports as the public framework surface
- validate that each named export points to one node file
- treat it as the canonical index of public app entrypoints

## Greenfield Workflow

A likely greenfield setup would be:

1. Create a fresh Next.js app.
2. Run something like `agentscript install next`.
3. Add `src/nodes/**`.
4. Expand `src/index.ts` into the named-export public surface.
5. Keep `app/**` files thin and route all meaningful logic into nodes.

## Recommendation

This looks like the cleanest first version of Next.js support.

It does not try to replace Next's file router. It simply constrains where the real logic lives, and uses `src/index.ts` as the explicit seam between the Next runtime and the AgentScript graph.
