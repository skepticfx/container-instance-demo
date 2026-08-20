import { DurableObject } from "cloudflare:workers";
import pRetry from "p-retry";

const CONTAINER_PORT = 8080;
const STARTUP_RETRIES = 5;
const STARTUP_RETRY_DELAY_MS = 500;
const INACTIVITY_TIMEOUT_MS = 60_000;

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

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("This demo proxies GET and HEAD requests only.", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }

    const abortController = new AbortController();
    if (!container.running) {
      const options: ContainerStartupOptions = {
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
      };
      container.start(options);
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
