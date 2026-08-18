# Container Instance Groups demo

A minimal Worker whose Durable Objects start namespace-backed containers on demand.

## Prerequisites

- Node.js and Docker
- A Cloudflare account with Workers, Containers, and Container Instance Groups enabled

## Deploy

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

- `exports.Sandbox.container` opts the Durable Object namespace into the Instance Group model.
- `images` tells Wrangler to build, push, prepare, and inject a digest-pinned `SANDBOX_IMAGE` binding.
- Wrangler resolves the deployed namespace and configures it in Coordinator without creating an ApplicationsV3 application.
- The Durable Object uses the injected image with `ctx.container.start()` and proxies requests to the container.
