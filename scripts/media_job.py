"""Private staging for AI input. The caller releases the lease after AI settles."""
import hashlib
import hmac
import importlib.util
import json
import re
import tempfile
import time
from io import BytesIO
from pathlib import Path

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
    prefix = PREFIX + data["jobId"] + "/"
    claim = prefix + "lease.json"
    # A duplicate signed request must never delete files an active AI reader is using.
    blob.put_blob(claim, json.dumps({"at": data["at"]}).encode(), access="private", content_type="application/json")
    paths = [claim]
    try:
        with tempfile.TemporaryDirectory(prefix="inthon-media-") as directory:
            manifest = download(data["url"], directory, max_entries=MAX_ITEMS, max_video_bytes=MAX_VIDEO)
            files = manifest["files"]
            if not 1 <= len(files) <= MAX_ITEMS:
                raise ValueError("Invalid media count")
            result = {"sourceUrl": data["url"], "caption": manifest["caption"][:5000], "files": []}
            total = 0
            for item in files:
                path = Path(directory) / item["file"]
                if path.resolve().parent != Path(directory).resolve() or not path.is_file():
                    raise ValueError("Invalid media path")
                original = path.read_bytes()
                total += len(original)
                if total > 80 * 1024 * 1024:
                    raise ValueError("Media job exceeds 80 MiB")
                key = prefix + "original_" + path.name
                paths.append(key)  # Include writes whose acknowledgement might be lost.
                blob.put_blob(key, original, access="private", content_type="application/octet-stream")
                if item["kind"] == "image":
                    body, (width, height) = ai_image(path)
                    key = prefix + f"ai_{item['index']:02d}.jpg"
                    paths.append(key)
                    blob.put_blob(key, body, access="private", content_type="image/jpeg")
                    content_type = "image/jpeg"
                elif item["kind"] == "video" and path.suffix.lower() == ".mp4" and len(original) <= MAX_VIDEO:
                    body, content_type = original, "video/mp4"
                    width, height = item.get("width"), item.get("height")
                else:
                    raise ValueError("Unsupported media")
                result["files"].append({"index": item["index"], "kind": item["kind"], "path": key,
                                        "bytes": len(body), "contentType": content_type, "width": width, "height": height})
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
