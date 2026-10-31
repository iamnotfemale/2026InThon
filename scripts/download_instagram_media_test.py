import importlib.util
import unittest
import sys
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from pathlib import Path

spec = importlib.util.spec_from_file_location("media", Path(__file__).with_name("download-instagram-media.py"))
media = importlib.util.module_from_spec(spec)
spec.loader.exec_module(media)


class MediaChecks(unittest.TestCase):
    def test_parallel_mixed_download_keeps_every_item_in_original_order(self):
        barrier = threading.Barrier(3, timeout=5)
        lock = threading.Lock()
        active = peak = 0
        def transfer(target):
            nonlocal active, peak
            index = int(target.stem.split('_')[-1])
            with lock:
                active += 1
                peak = max(peak, active)
            try:
                if index <= 3:
                    barrier.wait()
                target.write_bytes(b'0000ftypisom' if target.suffix == '.mp4' else b'image')
                return target
            finally:
                with lock:
                    active -= 1
        class YDL:
            def __init__(self, options):
                self.options = options
            def __enter__(self):
                return self
            def __exit__(self, *args):
                pass
            def process_ie_result(self, entry, download):
                entry['target'] = str(self.options['outtmpl']).replace('%(ext)s', 'mp4')
                transfer(Path(entry['target']))
                return entry
            def prepare_filename(self, entry):
                return entry['target']
        entries = [{'formats': [{'url': 'https://video.example.fbcdn.net/x.mp4'}]} if index in [2, 7]
                   else {'thumbnails': [{'url': 'https://image.example.fbcdn.net/x.jpg'}]} for index in range(1, 11)]
        with tempfile.TemporaryDirectory() as directory, patch.dict(sys.modules, {'yt_dlp': SimpleNamespace(YoutubeDL=YDL)}), \
                patch.object(media, 'save_image', side_effect=lambda url, target: transfer(target.with_suffix('.jpg'))):
            result = media.download('https://www.instagram.com/p/Example/', directory, info={'entries': entries})
            self.assertEqual([f['index'] for f in result['files']], list(range(1, 11)))
            self.assertEqual([f['kind'] for f in result['files']], ['video' if i in [2, 7] else 'image' for i in range(1, 11)])
            self.assertTrue(all((Path(directory) / f['file']).is_file() for f in result['files']))
            self.assertEqual(peak, 3)
            self.assertEqual(active, 0)

    def test_download_failure_waits_for_other_writers_and_does_not_publish_partial_manifest(self):
        failed, blocked, release = threading.Event(), threading.Event(), threading.Event()
        def save(url, target):
            if target.name.endswith('01'):
                self.assertTrue(blocked.wait(5))
                failed.set()
                raise OSError('transfer failed')
            blocked.set()
            self.assertTrue(release.wait(5))
            target = target.with_suffix('.jpg')
            target.write_bytes(b'image')
            return target
        info = {'entries': [{'thumbnails': [{'url': 'https://image.example.fbcdn.net/x.jpg'}]}] * 2}
        with tempfile.TemporaryDirectory() as directory, patch.dict(sys.modules, {'yt_dlp': SimpleNamespace(YoutubeDL=MagicMock())}), \
                patch.object(media, 'save_image', side_effect=save), ThreadPoolExecutor(max_workers=1) as caller:
            task = caller.submit(media.download, 'https://www.instagram.com/p/Example/', directory, info)
            try:
                self.assertTrue(failed.wait(5))
                self.assertFalse(task.done(), 'must wait for the other transfer before returning an error')
            finally:
                release.set()
            with self.assertRaises(OSError):
                task.result(timeout=5)
            self.assertFalse((Path(directory) / 'metadata.json').exists())

    def test_missing_or_excess_entries_fail_before_any_transfer(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(sys.modules, {'yt_dlp': SimpleNamespace(YoutubeDL=MagicMock())}), \
                patch.object(media, 'save_image') as save:
            for entries in [[None], [{}] * 11]:
                with self.assertRaises(ValueError):
                    media.download('https://www.instagram.com/p/Example/', directory, info={'entries': entries}, max_entries=10)
            save.assert_not_called()

    def test_reel_without_video_formats_never_succeeds_as_cover_image(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(sys.modules, {
                "yt_dlp": SimpleNamespace(YoutubeDL=MagicMock())}):
            with self.assertRaisesRegex(ValueError, "cover image is not the full video"):
                media.download("https://www.instagram.com/reel/Example123/", directory,
                               info={"thumbnails": [{"url": "https://scontent.example.fbcdn.net/cover.jpg"}]})

    def test_canonical_source_and_tracking_removal(self):
        self.assertEqual(media.canonical_url("https://www.instagram.com/p/Example_123/?img_index=3"),
                         "https://www.instagram.com/p/Example_123/")
        for value in ["http://instagram.com/p/x", "https://instagram.com.evil/p/x/",
                      "https://user@instagram.com/p/x/", "https://instagram.com/accounts/login/",
                      "https://instagram.com:8443/p/x/"]:
            with self.assertRaises(ValueError):
                media.canonical_url(value)

    def test_media_hosts_reject_credentials_and_unexpected_hosts(self):
        media.check_media_url("https://scontent.example.fbcdn.net/a.jpg")
        for value in ["http://scontent.fbcdn.net/a.jpg", "https://localhost/a.jpg",
                      "https://fbcdn.net.evil/a.jpg", "https://user:x@scontent.fbcdn.net/a.jpg"]:
            with self.assertRaises(ValueError):
                media.check_media_url(value)

    def test_image_candidates_use_largest_pixel_area_and_missing_data_fails(self):
        self.assertEqual(media.best_image({"thumbnails": [
            {"url": "small", "width": 320, "height": 320},
            {"url": "large", "width": 2700, "height": 3600},
            {"width": 9999, "height": 9999},
        ]})["url"], "large")
        with self.assertRaises(ValueError):
            media.best_image({})

    def test_unknown_dimensions_keep_ytdlp_preferred_last_candidate(self):
        self.assertEqual(media.best_image({"thumbnails": [
            {"url": "square-preview"}, {"url": "uncropped-original"},
        ]})["url"], "uncropped-original")

    def test_unscaled_source_beats_last_resized_webp_without_dimension_metadata(self):
        original = "https://scontent.example.fbcdn.net/image.jpg"
        self.assertEqual(media.best_image({"thumbnails": [
            {"url": original},
            {"url": "https://scontent.example.fbcdn.net/a?stp=dst-webp_s1080x1080"},
            {"url": "https://scontent.example.fbcdn.net/a?stp=dst-webp_s640x640"},
        ]})["url"], original)
        self.assertIn("s1080x1080", media.best_image({"thumbnails": [
            {"url": "https://scontent.example.fbcdn.net/a?stp=dst-webp_s1080x1080"},
            {"url": "https://scontent.example.fbcdn.net/a?stp=dst-webp_s640x640"},
        ]})["url"])

    def test_webhook_url_and_opaque_media_id_rejection(self):
        self.assertEqual(media.source_from_attachment({"type": "ig_reel", "payload": {
            "url": "https://www.instagram.com/reel/Example123/?tracking=1"}}),
            "https://www.instagram.com/reel/Example123/")
        for attachment in [{}, {"type": "ig_post", "payload": {"ig_post_media_id": "../x"}},
                           {"type": "ig_post", "payload": {"ig_post_media_id": "482584233761418119",
                            "url": "https://lookaside.fbsbx.com/ig_messaging_cdn/"}}]:
            with self.assertRaises(ValueError):
                media.source_from_attachment(attachment)


if __name__ == "__main__":
    unittest.main()
