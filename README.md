# Container Instance Groups demo

A minimal Worker whose Durable Objects start namespace-backed containers on demand.

## Prerequisites

- Node.js and Docker
- A Cloudflare account with Workers, Containers, and the new runtime enabled.

## Deploy

```bash
npm install
```

Use a custom wrangler based on this PR, until this is upstream: https://github.com/cloudflare/workers-sdk/pull/15141

Authenticate, then deploy with the Wrangler PR build:

```bash
npx https://pkg.pr.new/wrangler@15141 whoami
npx https://pkg.pr.new/wrangler@15141 deploy
```

Wrangler builds and pushes the image, converts it to run on Cloudflare, uploads the Worker, and configures the Instance Group.

## Try it

Use the Worker URL printed by Wrangler:

```bash
curl "https://<worker-url>/?instance=first"
curl "https://<worker-url>/_status?instance=first"
curl "https://<worker-url>/_destroy?instance=first"
```

Each `instance` value selects a different Durable Object and container.

## What changed

- `exports.<Class_Name>.container` opts the Durable Object namespace into the Instance Group model.
- `images` tells Wrangler to build, push, prepare, and inject a digest-pinned `SANDBOX_IMAGE` binding.
