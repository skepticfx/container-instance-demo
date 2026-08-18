import json
import os
import socket
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


STARTED_AT = datetime.now(timezone.utc).isoformat()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps(
            {
                "message": "hello from a bottom-up Container Instance",
                "path": self.path,
                "hostname": socket.gethostname(),
                "durable_object_id": os.environ.get("DURABLE_OBJECT_ID"),
                "environment": dict(sorted(os.environ.items())),
                "started_at": STARTED_AT,
            },
            indent=2,
        ).encode()

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_HEAD(self):
        self.send_response(200)
        self.end_headers()

    def log_message(self, format, *args):
        print(json.dumps({"message": format % args}))


ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
