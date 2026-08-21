import { DurableObject } from "cloudflare:workers";
import pRetry from "p-retry";

const CONTAINER_PORT = 8080;
const STARTUP_RETRIES = 5;
const STARTUP_RETRY_DELAY_MS = 500;
const INACTIVITY_TIMEOUT_MS = 60_000;
const EXEC_READY_RETRIES = 20;
const EXEC_READY_DELAY_MS = 300;
const SNAPSHOT_STORAGE_KEY = "latest-directory-snapshot";

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

interface ExecRequest {
  command: string[];
  cwd?: string;
  env?: Record<string, string>;
}

interface SnapshotRequest {
  dir: string;
  name?: string;
}

interface RestoreRequest {
  snapshot?: ContainerDirectorySnapshot;
  mountPoint?: string;
}

export class Sandbox extends DurableObject<Env> {
  private get container(): Container {
    if (this.ctx.container === undefined) {
      throw new Error("Sandbox was started without a Container attachment.");
    }
    return this.ctx.container;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const container = this.container;

    if (url.pathname === "/_status") {
      return Response.json({ running: container.running });
    }

    if (url.pathname === "/_destroy") {
      if (container.running) {
        await container.destroy();
      }
      return Response.json({ running: container.running });
    }

    if (request.method === "POST" && url.pathname === "/_exec") {
      return await this.handleControlRequest(() => this.handleExec(request));
    }

    if (request.method === "POST" && url.pathname === "/_snapshot") {
      return await this.handleControlRequest(() => this.handleSnapshot(request));
    }

    if (request.method === "POST" && url.pathname === "/_restore") {
      return await this.handleControlRequest(() => this.handleRestore(request));
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("This demo proxies GET and HEAD requests only.", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }

    const abortController = new AbortController();
    if (!container.running) {
      container.start(this.containerStartOptions());
      void container.monitor().then(
        () => {
          abortController.abort(
            new Error("Container exited before the server became ready.")
          );
        },
        (error) => {
          abortController.abort(
            error instanceof Error ? error : new Error(String(error))
          );
        }
      );
    }

    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
    return await this.fetchContainerWhenReady(
      request,
      container,
      abortController.signal
    );
  }

  // Every code path starts the container through these options. `restore` is
  // only supplied when mounting a previously captured directory snapshot.
  private containerStartOptions(
    restore?: ContainerDirectorySnapshotRestoreParams
  ): ContainerStartupOptions {
    return {
      // Restore these fields and remove the matching temporary environment
      // variables after https://github.com/cloudflare/workerd/pull/6992 is
      // released to production Edgeworker.
      // image: this.env.SANDBOX_IMAGE,
      // instance: "lite",
      entrypoint: ["/server", "8080"],
      enableInternet: false,
      env: {
        NAME: "container-instance-demo",
        MESSAGE: "hello from a bottom-up Container Instance",
        DURABLE_OBJECT_ID: this.ctx.id.toString(),
        CLOUDFLARE_EXPERIMENTAL_CUSTOM_IMAGE: this.env.SANDBOX_IMAGE,
        CLOUDFLARE_EXPERIMENTAL_INSTANCE_TYPE: "lite",
      },
      ...(restore === undefined ? {} : { directorySnapshots: [restore] }),
    };
  }

  private async ensureContainerReady(
    restore?: ContainerDirectorySnapshotRestoreParams
  ): Promise<void> {
    if (this.container.running) {
      // A snapshot can only be mounted at startup, so refuse rather than
      // silently ignoring it.
      if (restore !== undefined) {
        throw new Error("cannot restore a snapshot into a running container");
      }
    } else {
      this.container.start(this.containerStartOptions(restore));
    }

    // `running` only means start() was called, not that the container accepts
    // exec yet, so always probe before issuing the real command.
    await pRetry(
      async () => {
        const process = await this.container.exec(["/bin/sh", "-c", "true"], {
          stdout: "pipe",
          stderr: "pipe",
        });
        await process.output();
      },
      {
        retries: EXEC_READY_RETRIES,
        minTimeout: EXEC_READY_DELAY_MS,
        // Fixed interval. The exponential default would wait ~5 minutes.
        factor: 1,
      }
    );
  }

  private async handleControlRequest(
    handler: () => Promise<Response>
  ): Promise<Response> {
    try {
      return await handler();
    } catch (error) {
      if (error instanceof HttpError) {
        return Response.json({ error: error.message }, { status: error.status });
      }

      const detail = error instanceof Error ? error.message : String(error);
      console.error("Container control request failed.", error);
      return Response.json(
        { error: "container control request failed", detail },
        { status: 500 }
      );
    }
  }

  private async handleExec(request: Request): Promise<Response> {
    const input = await this.readJson<ExecRequest>(request);
    if (
      !Array.isArray(input.command) ||
      input.command.length === 0 ||
      input.command.some((part) => typeof part !== "string")
    ) {
      throw new HttpError(400, "command must be a non-empty string array");
    }

    await this.ensureContainerReady();
    const process = await this.container.exec(input.command, {
      cwd: input.cwd,
      env: input.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await process.output();

    return Response.json({
      stdout: new TextDecoder().decode(output.stdout),
      stderr: new TextDecoder().decode(output.stderr),
      exitCode: output.exitCode,
    });
  }

  private async handleSnapshot(request: Request): Promise<Response> {
    const input = await this.readJson<SnapshotRequest>(request);
    if (typeof input.dir !== "string" || !input.dir.startsWith("/")) {
      throw new HttpError(400, "dir must be an absolute path");
    }

    await this.ensureContainerReady();
    const snapshot = await this.container.snapshotDirectory({
      dir: input.dir,
      name: input.name,
    });
    await this.ctx.storage.put(SNAPSHOT_STORAGE_KEY, snapshot);

    return Response.json(snapshot);
  }

  private async handleRestore(request: Request): Promise<Response> {
    const input = await this.readJson<RestoreRequest>(request);
    const snapshot =
      input.snapshot ??
      (await this.ctx.storage.get<ContainerDirectorySnapshot>(
        SNAPSHOT_STORAGE_KEY
      ));
    if (snapshot === undefined) {
      throw new HttpError(404, "no directory snapshot is available");
    }

    const mountPoint = input.mountPoint ?? snapshot.dir;
    if (!mountPoint.startsWith("/")) {
      throw new HttpError(400, "mountPoint must be an absolute path");
    }

    // Replacing the container is a multi-step operation. Block other events so
    // a concurrent request cannot observe or race the destroy/start window.
    await this.ctx.blockConcurrencyWhile(async () => {
      if (this.container.running) {
        await this.container.destroy();
      }
      await this.ensureContainerReady({ snapshot, mountPoint });
    });

    return Response.json({ restored: true, snapshot, mountPoint });
  }

  private async readJson<T>(request: Request): Promise<T> {
    if (request.headers.get("content-length") === "0") {
      return {} as T;
    }

    let value: unknown;
    try {
      value = await request.json();
    } catch {
      throw new HttpError(400, "request body must be valid JSON");
    }

    if (value === null || typeof value !== "object") {
      throw new HttpError(400, "request body must be a JSON object");
    }

    return value as T;
  }

  private async fetchContainerWhenReady(
    request: Request,
    container: Container,
    signal: AbortSignal
  ): Promise<Response> {
    try {
      return await pRetry(
        async () => {
          return await container
            .getTcpPort(CONTAINER_PORT)
            .fetch(request.url.replace("https://", "http://"), request);
        },
        {
          retries: STARTUP_RETRIES,
          minTimeout: STARTUP_RETRY_DELAY_MS,
          signal,
        }
      );
    } catch (error) {
      return Response.json(
        {
          error: "container did not become ready",
          detail: error instanceof Error ? error.message : String(error),
        },
        { status: 503 }
      );
    }
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const instanceName = url.searchParams.get("instance") ?? "default";
    url.searchParams.delete("instance");

    const id = env.SANDBOX.idFromName(instanceName);
    const stub = env.SANDBOX.get(id);
    return await stub.fetch(new Request(url, request));
  },
} satisfies ExportedHandler<Env>;
