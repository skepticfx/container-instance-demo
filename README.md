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

## Container snapshots

Four additional endpoints demonstrate full container snapshots:

- `POST /_write_file` writes `contents` to an absolute `path`, creating parent directories.
- `GET /_read_file?path=` returns the contents of a file.
- `POST /_snapshot` captures the whole container with `container.snapshotContainer()` and stores it as the latest snapshot for that Durable Object.
- `POST /_restore` starts a fresh container from a snapshot, using the stored one unless a `snapshot` is supplied in the body.

Write a file, snapshot the container, destroy it, then restore:

```bash
BASE="https://<worker-url>"
INSTANCE="snapshot-demo"

curl "$BASE/_write_file?instance=$INSTANCE" \
  -X POST -H 'Content-Type: application/json' \
  -d '{"path":"/opt/demo/state.txt","contents":"before-snapshot\n"}'

curl "$BASE/_snapshot?instance=$INSTANCE" \
  -X POST -H 'Content-Type: application/json' \
  -d '{"name":"demo-container"}'

curl "$BASE/_destroy?instance=$INSTANCE"

curl "$BASE/_restore?instance=$INSTANCE" \
  -X POST -H 'Content-Type: application/json' -d '{}'

curl "$BASE/_read_file?instance=$INSTANCE&path=/opt/demo/state.txt"
```

The last command returns `before-snapshot` from the restored container.

`containerSnapshot` is only passed to `container.start()` when restoring, so the normal startup path is unchanged. A snapshot already identifies the image, so the image is not sent alongside it.

`/_write_file` and `/_read_file` are implemented with `container.exec()`, passing the path and contents as positional shell arguments so neither can be interpreted as shell syntax.

## What changed

- `exports.<Class_Name>.container` opts the Durable Object namespace into the Instance Group model.
- `images` tells Wrangler to build, push, prepare, and inject a digest-pinned `SANDBOX_IMAGE` binding.
- Wrangler resolves the deployed namespace and configures it in Coordinator without creating an ApplicationsV3 application.
- Until [workerd PR #6992](https://github.com/cloudflare/workerd/pull/6992) reaches production Edgeworker, the Durable Object passes the injected image and instance type through temporary container environment variables.
