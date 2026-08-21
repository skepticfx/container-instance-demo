# Container Instance Groups demo

A minimal Worker whose Durable Objects start namespace-backed containers on demand.

## Prerequisites

- Node.js and Docker
- A Cloudflare account with Workers, Containers, and Container Instance Groups enabled

## Deploy

```bash
npm install
```


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

## Directory snapshots

Three additional endpoints demonstrate directory snapshots:

- `POST /_exec` runs a command in the container and returns `stdout`, `stderr`, and `exitCode`.
- `POST /_snapshot` snapshots an absolute directory and stores it as the latest snapshot for that Durable Object.
- `POST /_restore` starts a fresh container with a snapshot mounted. It uses the stored snapshot unless one is supplied in the body.

Create a file, snapshot it, destroy the container, then restore it:

```bash
BASE="https://<worker-url>"
INSTANCE="snapshot-demo"

curl "$BASE/_exec?instance=$INSTANCE" \
  -X POST -H 'Content-Type: application/json' \
  -d '{"command":["sh","-c","mkdir -p /workspace/source && printf before-snapshot > /workspace/source/message.txt"]}'

curl "$BASE/_snapshot?instance=$INSTANCE" \
  -X POST -H 'Content-Type: application/json' \
  -d '{"dir":"/workspace/source","name":"demo-directory"}'

curl "$BASE/_destroy?instance=$INSTANCE"

curl "$BASE/_restore?instance=$INSTANCE" \
  -X POST -H 'Content-Type: application/json' \
  -d '{"mountPoint":"/workspace/restored"}'

curl "$BASE/_exec?instance=$INSTANCE" \
  -X POST -H 'Content-Type: application/json' \
  -d '{"command":["cat","/workspace/restored/message.txt"]}'
```

The final command prints `before-snapshot` from the restored directory.

## What changed

- `exports.<Class_Name>.container` opts the Durable Object namespace into the Instance Group model.
- `images` tells Wrangler to build, push, prepare, and inject a digest-pinned `SANDBOX_IMAGE` binding.
- Wrangler resolves the deployed namespace and configures it in Coordinator without creating an ApplicationsV3 application.
- Until [workerd PR #6992](https://github.com/cloudflare/workerd/pull/6992) reaches production Edgeworker, the Durable Object passes the injected image and instance type through temporary container environment variables.
