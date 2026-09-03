# Durable Object-managed Containers demo

A minimal Worker whose Durable Objects start namespace-backed containers on demand.

## Prerequisites

- Node.js, pnpm, and Docker
- A Cloudflare account with Workers, Containers, and the new runtime enabled.

## Deploy

Install dependencies:

```bash
pnpm install
```

Use the preview Wrangler build from [workers-sdk PR #15480](https://github.com/cloudflare/workers-sdk/pull/15480) until it is upstream.

Authenticate, then deploy with the Wrangler PR build:

```bash
npx --yes https://pkg.pr.new/wrangler@15480 whoami
npx --yes https://pkg.pr.new/wrangler@15480 deploy
```

Wrangler builds and pushes the image, prepares it to run on Cloudflare, uploads the Worker, and creates the namespace-backed application.

## Try it

Use the Worker URL printed by Wrangler:

```bash
curl "https://<worker-url>/?instance=first"
curl "https://<worker-url>/_status?instance=first"
curl "https://<worker-url>/_destroy?instance=first"
```

Each `instance` value selects a different Durable Object and container.

## What changed

- The top-level `containers[]` entry attaches a Durable Object-managed application to the `Sandbox` namespace.
- `scheduling_policy: "durable_object"` makes each Durable Object own its container lifecycle.
- The named `images.app` configuration tells Wrangler to build, push, and prepare the image.
- Wrangler exposes prepared images through the class-scoped `env.EXPERIMENTAL_CLOUDFLARE_CONTAINER_IMAGES` map.
