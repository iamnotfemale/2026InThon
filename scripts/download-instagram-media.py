"""Download a public Instagram reel or carousel locally; no browser/session cookies.

Requires yt-dlp. Optionally accept already-extracted yt-dlp JSON on stdin so a
diagnostic run need not fetch the same metadata twice. Media URLs stay out of
the output manifest; captions and canonical source links are kept locally.
"""
import argparse
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from urllib.request import Request, build_opener, HTTPRedirectHandler


def canonical_url(value):
    url = urlparse(value)
    if (url.scheme != "https" or url.hostname not in {"www.instagram.com", "instagram.com"}
            or url.username or url.password or url.port not in {None, 443}
            or not re.fullmatch(r"/(?:p|reel|reels|tv)/[A-Za-z0-9_-]+/?", url.path)):
        raise ValueError("Expected a public Instagram post or reel URL")
    return "https://www.instagram.com" + url.path.rstrip("/") + "/"


def source_from_attachment(attachment):
    payload = attachment.get("payload") or {}
    try:
        return canonical_url(payload.get("url") or "")
    except ValueError as error:
        # The webhook's Graph media ID is not reliably the native Instagram PK.
        raise ValueError("Attachment has no original post URL; supply the original Instagram link") from error


def check_media_url(value):
    url = urlparse(value)
    allowed = (".cdninstagram.com", ".fbcdn.net", ".fbsbx.com")
    if (url.scheme != "https" or not (url.hostname or "").endswith(allowed)
            or url.username or url.password or url.port not in {None, 443}):
        raise ValueError("Unexpected media host")
    return value


def best_image(entry):
    images = [image for image in entry.get("thumbnails", []) if image.get("url")]
    if not images:
        raise ValueError("No image candidates available")
    def quality(pair):
        index, image = pair
        url = urlparse(image["url"])
        transform = parse_qs(url.query).get("stp", [""])[0]
        resize = re.search(r"(?:^|[_/])(?:s|p)(\d+)x(\d+)", url.path + "/" + transform)
        area = (image.get("width") or 0) * (image.get("height") or 0)
        if not area and resize:
            area = int(resize[1]) * int(resize[2])
        # Candidate order can end with a tiny WebP; prefer the unscaled source.
        return (resize is None, area, index)
    return max(enumerate(images), key=quality)[1]


class MediaRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_media_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def save_image(url, output):
    request = Request(check_media_url(url), headers={"User-Agent": "Mozilla/5.0", "Referer": "https://www.instagram.com/"})
    with build_opener(MediaRedirects).open(request, timeout=30) as response:
        if not response.headers.get_content_type().startswith("image/"):
            raise ValueError("Media response is not an image")
        data = response.read(20 * 1024 * 1024 + 1)
        if len(data) > 20 * 1024 * 1024:
            raise ValueError("Image exceeds 20 MiB limit")
    if data[:2] == b"\xff\xd8":
        ext = ".jpg"
    elif data[:8] == b"\x89PNG\r\n\x1a\n":
        ext = ".png"
    elif data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        ext = ".webp"
    else:
        raise ValueError("Image signature not recognized")
    target = output.with_suffix(ext)
    if target.exists():
        if target.read_bytes() == data:
            return target
        raise FileExistsError("Existing image differs; choose a new output directory")
    with target.open("xb") as file:
        file.write(data)
    return target


class QuietLogger:
    def debug(self, message):
        pass

    def warning(self, message):
        pass  # Image-only entries legitimately have no video formats.

    def error(self, message):
        pass  # The caller reports the exception without temporary media URLs.


def download(url, directory, info=None, ffmpeg=None):
    import yt_dlp

    source = canonical_url(url)
    directory = Path(directory).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    options = {"quiet": True, "noprogress": True, "logger": QuietLogger(),
               "socket_timeout": 20, "retries": 1, "extractor_retries": 1,
               "ignore_no_formats_error": True, "skip_download": True}
    with yt_dlp.YoutubeDL(options) as ydl:
        info = info or ydl.extract_info(source, download=False)
    entries = info.get("entries") or [info]
    if len(entries) > 20:
        raise ValueError("More than 20 media entries; split the test")
    if re.search(r"/(?:reels?|tv)/", source) and any(not entry.get("formats") for entry in entries):
        raise ValueError("Reel video formats unavailable; a cover image is not the full video")
    manifest = {"source": source, "caption": info.get("description") or "", "files": []}
    for index, entry in enumerate(entries, start=1):
        if entry.get("formats"):
            video_options = {**options, "skip_download": False, "noplaylist": True,
                             "ignore_no_formats_error": False, "format": "b[ext=mp4]/b",
                             "max_filesize": 150 * 1024 * 1024, "nopart": False,
                             "outtmpl": str(directory / f"video_{index:02d}.%(ext)s")}
            if ffmpeg:
                video_options["ffmpeg_location"] = ffmpeg
            with yt_dlp.YoutubeDL(video_options) as ydl:
                result = ydl.process_ie_result(dict(entry), download=True)
                target = Path(ydl.prepare_filename(result))
            if not target.is_file() or not target.stat().st_size:
                raise ValueError("Video download not confirmed")
            manifest["files"].append({"index": index, "kind": "video", "file": target.name,
                                      "bytes": target.stat().st_size, "width": result.get("width"),
                                      "height": result.get("height"), "duration": result.get("duration")})
        else:
            image = best_image(entry)
            target = save_image(image["url"], directory / f"image_{index:02d}")
            manifest["files"].append({"index": index, "kind": "image", "file": target.name,
                                      "bytes": target.stat().st_size, "width": image.get("width"), "height": image.get("height")})
    (directory / "metadata.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (directory / "caption.txt").write_text(manifest["caption"], encoding="utf-8")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url")
    parser.add_argument("output")
    inputs = parser.add_mutually_exclusive_group()
    inputs.add_argument("--metadata-stdin", action="store_true")
    inputs.add_argument("--attachment-stdin", action="store_true")
    parser.add_argument("--ffmpeg")
    args = parser.parse_args()
    try:
        data = json.loads(sys.stdin.buffer.read().decode("utf-8")) if args.metadata_stdin or args.attachment_stdin else None
        source = source_from_attachment(data) if args.attachment_stdin else args.url
        result = download(source, args.output, data if args.metadata_stdin else None, args.ffmpeg)
        print(json.dumps({"success": True, "files": result["files"]}))
    except Exception as error:
        message = re.sub(r"https?://\S+", "[URL]", str(error))
        print(json.dumps({"success": False, "error": message[:1200]}))
        sys.exit(1)
