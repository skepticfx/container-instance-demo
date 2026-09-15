# Durable Object-managed Containers demo

A minimal Worker whose Durable Objects start namespace-backed containers on demand.

## Prerequisites

- Node.js 22 or newer, pnpm 10.33.0, and Docker
- A Cloudflare account with Workers, Containers, and the new runtime enabled.

Wrangler is pinned to the published **4.132.0** release in `package.json` and the lockfile. All package scripts use that local version.

## Deploy

Install dependencies and verify the CLI version:

```bash
pnpm install
pnpm exec wrangler --version
```

Check the generated bindings, TypeScript, and Worker bundle locally:

```bash
pnpm check
pnpm deploy:dry
```

Check your account, then deploy. Run `pnpm exec wrangler login` first if you are not already logged in:

```bash
pnpm exec wrangler whoami
pnpm run deploy
```

Wrangler builds and pushes the image, prepares it to run on Cloudflare, uploads the Worker, and creates the namespace-backed application if it is missing. Normal deploys apply explicitly configured application settings; omitted settings are preserved.

## Try it

Use the Worker URL printed by Wrangler:

```bash
curl "https://<worker-url>/?instance=first"
curl "https://<worker-url>/_status?instance=first"
curl "https://<worker-url>/_destroy?instance=first"
```

Each `instance` value selects a different Durable Object and container.

## Configuration and runtime

- The existing `v1` migration declares the SQLite-backed `Sandbox` class. `containers[].class_name` attaches its container.
- `scheduling_policy: "durable_object"` makes each Durable Object own its container lifecycle.
- The named `images.app` configuration uses `dockerfile: "./container/Dockerfile"` and `build_context: "./container"`. Wrangler builds, pushes, and prepares that image. The Dockerfile's `COPY` instructions resolve against the container directory. Per-image `build_vars` can supply Docker build arguments when needed; this Dockerfile requires none.
- The Worker reads the resolved image from `this.ctx.container.images.app` and passes it to `container.start()`.
- Instance size, entrypoint, environment, and inactivity timeout are set in `src/index.ts` at runtime.
- Container image maps follow Worker versions during gradual deployments. Wrangler 4.132.0 still emits the temporary `EXPERIMENTAL_CLOUDFLARE_CONTAINER_IMAGES` binding, but this demo uses the native image API.
- Top-level `observability` enables Worker logs. Container application logs are configured separately with `containers[].observability`; omitting that setting preserves the application's existing configuration.
