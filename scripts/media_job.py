"""Private staging for AI input. The caller releases the lease after AI settles."""
import hashlib
import hmac
import importlib.util
import json
import re
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from threading import Lock

spec = importlib.util.spec_from_file_location("instagram_download", Path(__file__).with_name("download-instagram-media.py"))
downloader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(downloader)

PREFIX = "dm/media-jobs/"
MAX_ITEMS = 10
MAX_VIDEO = 20 * 1024 * 1024


def validate_request(body, signature, secret, now=None):
    if not secret or len(body) > 4096:
        raise ValueError("Unauthorized")
    expected = hmac.new(secret.encode(), b"inthon-media-v1:" + body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature or ""):
        raise ValueError("Unauthorized")
    data = json.loads(body)
    if not isinstance(data, dict):
        raise ValueError("Invalid body")
    if (not isinstance(data.get("jobId"), str) or not re.fullmatch(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", data["jobId"])
            or not isinstance(data.get("at"), int) or abs((now or time.time)() - data["at"]) > 180):
        raise ValueError("Expired or invalid job")
    data["url"] = downloader.canonical_url(data.get("url", ""))
    if not isinstance(data.get("directVideo", False), bool):
        raise ValueError("Invalid video mode")
    return data


def ai_image(path):
    from PIL import Image, ImageOps
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
        image.thumbnail((2048, 2048))
        for quality in (85, 75, 60):
            output = BytesIO()
            image.save(output, "JPEG", quality=quality)
            if output.tell() <= 1536 * 1024:
                return output.getvalue(), image.size
    raise ValueError("Image exceeds AI input budget")


def prepare_job(data, blob, download=downloader.download):
    started = time.perf_counter()
    prefix = PREFIX + data["jobId"] + "/"
    claim = prefix + "lease.json"
    # A duplicate signed request must never delete files an active AI reader is using.
    blob.put_blob(claim, json.dumps({"at": data["at"]}).encode(), access="private", content_type="application/json")
    lease_ms = round((time.perf_counter() - started) * 1000)
    paths = [claim]
    try:
        with tempfile.TemporaryDirectory(prefix="inthon-media-") as directory:
            download_started = time.perf_counter()
            manifest = download(data["url"], directory, max_entries=MAX_ITEMS, max_video_bytes=MAX_VIDEO)
            download_ms = round((time.perf_counter() - download_started) * 1000)
            files = manifest["files"]
            if not 1 <= len(files) <= MAX_ITEMS:
                raise ValueError("Invalid media count")
            result = {"sourceUrl": data["url"], "caption": manifest["caption"][:5000], "files": []}
            total = 0
            validated = []
            for index, item in enumerate(files, start=1):
                path = Path(directory) / item["file"]
                if (item["index"] != index or path.resolve().parent != Path(directory).resolve()
                        or not path.is_file() or path.name in {p.name for _, p in validated}):
                    raise ValueError("Invalid media path")
                size = path.stat().st_size
                total += size
                if total > 80 * 1024 * 1024:
                    raise ValueError("Media job exceeds 80 MiB")
                if not size or item["kind"] not in {"image", "video"}:
                    raise ValueError("Unsupported media")
                if item["kind"] == "video" and (path.suffix.lower() != ".mp4" or size > MAX_VIDEO):
                    raise ValueError("Unsupported media")
                validated.append((item, path))
                paths.append(prefix + "original_" + path.name)
                if item["kind"] == "image":
                    paths.append(prefix + f"ai_{index:02d}.jpg")

            image_lock = Lock()
            def stage_file(pair):
                item, path = pair
                original = path.read_bytes()
                key = prefix + "original_" + path.name
                blob.put_blob(key, original, access="private", content_type="application/octet-stream")
                if item["kind"] == "image":
                    # Bound full-resolution Pillow memory while independent uploads overlap.
                    with image_lock:
                        body, (width, height) = ai_image(path)
                    key = prefix + f"ai_{item['index']:02d}.jpg"
                    blob.put_blob(key, body, access="private", content_type="image/jpeg")
                    content_type = "image/jpeg"
                elif item["kind"] == "video" and path.suffix.lower() == ".mp4" and len(original) <= MAX_VIDEO:
                    body, content_type = original, "video/mp4"
                    width, height = item.get("width"), item.get("height")
                else:
                    raise ValueError("Unsupported media")
                return {"index": item["index"], "kind": item["kind"], "path": key,
                        "bytes": len(body), "contentType": content_type, "width": width, "height": height}
            stage_started = time.perf_counter()
            # Register all possible writes first, then wait for every upload before returning or cleaning up.
            with ThreadPoolExecutor(max_workers=3) as pool:
                result["files"] = list(pool.map(stage_file, validated))
            result["timings"] = {**manifest.get("timings", {}), "lease_ms": lease_ms, "download_ms": download_ms,
                                 "stage_ms": round((time.perf_counter() - stage_started) * 1000),
                                 "total_ms": round((time.perf_counter() - started) * 1000)}
            # Local copies can go now: private durable copies remain until the Node AI caller releases them.
            return result
    except Exception:
        if paths:
            blob.delete_blob(paths)
        raise


def purge_stale(blob, now=None):
    cutoff = (now or time.time)() - 3600
    stale = [item.pathname for item in blob.query_blobs(prefix=PREFIX)
             if item.uploaded_at.timestamp() < cutoff]
    for index in range(0, len(stale), 1000):
        blob.delete_blob(stale[index:index + 1000])
    return len(stale)
