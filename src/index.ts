import { DurableObject } from "cloudflare:workers";

const CONTAINER_PORT = 8080;
const STARTUP_TIMEOUT_MS = 30_000;
const RETRY_INTERVAL_MS = 250;
const INACTIVITY_TIMEOUT_MS = 60_000;

export class Sandbox extends DurableObject<Env> {
  private containerMonitor?: Promise<void>;

  private get container(): Container {
    if (this.ctx.container === undefined) {
      throw new Error("Sandbox was started without a Container attachment.");
    }
    return this.ctx.container;
  }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    if (this.container.running) {
      this.startMonitor();
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_status") {
      return Response.json({ running: this.container.running });
    }

    if (url.pathname === "/_destroy") {
      if (this.container.running) {
        await this.container.destroy();
      }
      return Response.json({ running: this.container.running });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("This demo proxies GET and HEAD requests only.", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }

    if (!this.container.running) {
      const options: ContainerStartupOptions = {
        // Restore these fields and remove the matching temporary environment
        // variables after https://github.com/cloudflare/workerd/pull/6992 is
        // released to production Edgeworker.
        // image: this.env.SANDBOX_IMAGE,
        // instance: "lite",
        entrypoint: ["/usr/local/bin/python", "-u", "/app/server.py"],
        enableInternet: false,
        env: {
          CLOUDFLARE_EXPERIMENTAL_CUSTOM_IMAGE: this.env.SANDBOX_IMAGE,
          CLOUDFLARE_EXPERIMENTAL_INSTANCE_TYPE: "lite",
          DURABLE_OBJECT_ID: this.ctx.id.toString(),
          PATH: "/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin",
        },
      };
      this.container.start(options);
      void this.container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS).catch(
        (error) => {
          console.error("Failed to set container inactivity timeout.", error);
        }
      );
      this.startMonitor();
    }

    return await this.fetchContainerWhenReady(request);
  }

  private startMonitor(): void {
    const monitor = this.container.monitor();
    this.containerMonitor = monitor;
    void monitor
      .catch((error) => {
        console.error("Container stopped.", error);
      })
      .finally(() => {
        if (this.containerMonitor === monitor) {
          this.containerMonitor = undefined;
        }
      });
  }

  private async fetchContainerWhenReady(request: Request): Promise<Response> {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    const containerUrl = new URL(request.url);
    containerUrl.protocol = "http:";
    const containerRequest = new Request(containerUrl, request);
    let lastError = "container port is not ready";

    while (Date.now() < deadline) {
      try {
        return await this.container
          .getTcpPort(CONTAINER_PORT)
          .fetch(containerRequest);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
      }
    }

    return Response.json(
      {
        error: "container did not become ready",
        detail: lastError,
      },
      { status: 503 }
    );
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
