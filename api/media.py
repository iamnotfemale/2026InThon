from http.server import BaseHTTPRequestHandler
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor

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
            started = time.perf_counter()
            from vercel.blob import sync as blob
            sdk_ms = round((time.perf_counter() - started) * 1000)
            def purge():
                purge_started = time.perf_counter()
                purge_stale(blob)
                return round((time.perf_counter() - purge_started) * 1000)
            # Old-job recovery and the new job use disjoint ages; both finish before the response.
            with ThreadPoolExecutor(max_workers=2) as pool:
                cleanup = pool.submit(purge)
                result = prepare_job(data, blob)
                purge_ms = cleanup.result()
            print(json.dumps({"event": "MEDIA_PREP_TIMING", **result["timings"], "sdk_ms": sdk_ms,
                              "purge_ms": purge_ms, "handler_ms": round((time.perf_counter() - started) * 1000)}))
            self.respond(200, result)
        except Exception as error:
            # yt-dlp errors can contain signed CDN URLs; do not log exception bodies.
            print(json.dumps({"event": "media_unavailable", "type": type(error).__name__}))
            self.respond(422, {"error": "media_unavailable"})
