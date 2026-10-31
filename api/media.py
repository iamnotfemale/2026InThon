from http.server import BaseHTTPRequestHandler
import json
import os

from scripts.media_job import validate_request, prepare_job, purge_stale


class handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def respond(self, status, value):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(value).encode())

    def do_GET(self):
        self.respond(405, {"error": "method_not_allowed"})

    def do_POST(self):
        try:
            size = int(self.headers.get("content-length", "0"))
            if not 0 < size <= 4096:
                raise ValueError("Invalid body")
            data = validate_request(self.rfile.read(size), self.headers.get("x-inthon-media-signature"),
                                    os.environ.get("META_APP_SECRET"))
        except (ValueError, TypeError, KeyError):
            return self.respond(403, {"error": "forbidden"})
        try:
            from vercel.blob import sync as blob
            purge_stale(blob)
            result = prepare_job(data, blob)
            self.respond(200, result)
        except Exception as error:
            # yt-dlp errors can contain signed CDN URLs; do not log exception bodies.
            print(json.dumps({"event": "media_unavailable", "type": type(error).__name__}))
            self.respond(422, {"error": "media_unavailable"})
