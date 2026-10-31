import hashlib
import hmac
import json
import tempfile
import unittest
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

from media_job import validate_request, prepare_job, ai_image, purge_stale, PREFIX

JOB = {"jobId": "11111111-1111-4111-8111-111111111111", "at": 1000,
       "url": "https://www.instagram.com/p/Example/"}


class MediaJobChecks(unittest.TestCase):
    def test_parallel_staging_keeps_all_mixed_media_private_and_ordered(self):
        from PIL import Image
        barrier = threading.Barrier(3, timeout=5)
        lock = threading.Lock()
        stored = {}
        active = peak = 0
        def put(key, body, **options):
            nonlocal active, peak
            self.assertEqual(options['access'], 'private')
            with lock:
                active += 1
                peak = max(peak, active)
            try:
                if any(key.endswith(f'original_{kind}_{i:02d}.{ext}') for i, kind, ext in [(1, 'image', 'jpg'), (2, 'video', 'mp4'), (3, 'image', 'jpg')]):
                    barrier.wait()
                stored[key] = body
            finally:
                with lock:
                    active -= 1
        def download(url, directory, **limits):
            files = []
            for i in range(1, 11):
                kind, ext = ('video', 'mp4') if i in [2, 7] else ('image', 'jpg')
                path = Path(directory) / f'{kind}_{i:02d}.{ext}'
                if kind == 'image':
                    Image.new('RGB', (24, 36), (i, 0, 0)).save(path)
                else:
                    path.write_bytes(b'0000ftypisom')
                files.append({'index': i, 'kind': kind, 'file': path.name})
            return {'caption': 'all ten', 'files': files}
        blob = SimpleNamespace(put_blob=put, delete_blob=Mock())
        result = prepare_job(JOB, blob, download=download)
        self.assertEqual([f['index'] for f in result['files']], list(range(1, 11)))
        self.assertEqual([f['kind'] for f in result['files']].count('video'), 2)
        self.assertEqual(len(stored), 19)
        self.assertTrue(all(f['path'] in stored and len(stored[f['path']]) == f['bytes'] for f in result['files']))
        self.assertEqual(peak, 3)
        self.assertEqual(active, 0)
        blob.delete_blob.assert_not_called()

    def test_failed_parallel_upload_waits_for_late_writes_then_removes_every_job_object(self):
        from PIL import Image
        failed, blocked, release = threading.Event(), threading.Event(), threading.Event()
        untouched = 'dm/media-jobs/other/keep'
        stored = {untouched: b'keep'}
        def put(key, body, **options):
            if key.endswith('original_image_01.jpg'):
                self.assertTrue(blocked.wait(5))
                stored[key] = body  # The write happened but its acknowledgement was lost.
                failed.set()
                raise OSError('lost ack')
            if key.endswith('original_image_02.jpg'):
                blocked.set()
                self.assertTrue(release.wait(5))
            stored[key] = body
        def delete(keys):
            self.assertTrue(release.is_set(), 'late writers must finish before cleanup')
            for key in keys:
                stored.pop(key, None)
        def download(url, directory, **limits):
            files = []
            for i in [1, 2]:
                path = Path(directory) / f'image_{i:02d}.jpg'
                Image.new('RGB', (2, 2)).save(path)
                files.append({'index': i, 'kind': 'image', 'file': path.name})
            return {'caption': '', 'files': files}
        blob = SimpleNamespace(put_blob=put, delete_blob=delete)
        with ThreadPoolExecutor(max_workers=1) as caller:
            task = caller.submit(prepare_job, JOB, blob, download)
            try:
                self.assertTrue(failed.wait(5))
                self.assertFalse(task.done())
            finally:
                release.set()
            with self.assertRaises(OSError):
                task.result(timeout=5)
        self.assertEqual(stored, {untouched: b'keep'})

    def test_missing_duplicate_or_oversize_media_fail_before_uploading_files(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'image_01.jpg'
            Image.new('RGB', (2, 2)).save(path)
            for files in [[{'index': 2, 'kind': 'image', 'file': path.name}],
                          [{'index': i, 'kind': 'image', 'file': path.name} for i in [1, 2]]]:
                blob = SimpleNamespace(put_blob=Mock(), delete_blob=Mock())
                def download(url, target, **limits):
                    (Path(target) / path.name).write_bytes(path.read_bytes())
                    return {'caption': '', 'files': files}
                with self.assertRaises(ValueError):
                    prepare_job(JOB, blob, download=download)
                self.assertEqual(blob.put_blob.call_count, 1, 'only the job lease may have been written')
            for size, kind in [(81 * 1024 * 1024, 'image'), (21 * 1024 * 1024, 'video')]:
                blob = SimpleNamespace(put_blob=Mock(), delete_blob=Mock())
                def oversized(url, target, **limits):
                    name = 'video_01.mp4' if kind == 'video' else 'image_01.jpg'
                    with (Path(target) / name).open('wb') as file:
                        file.truncate(size)
                    return {'caption': '', 'files': [{'index': 1, 'kind': kind, 'file': name}]}
                with self.assertRaises(ValueError):
                    prepare_job(JOB, blob, download=oversized)
                self.assertEqual(blob.put_blob.call_count, 1)

    def test_signed_body_cannot_be_tampered_replayed_late_or_used_for_non_instagram(self):
        body = json.dumps(JOB).encode()
        signature = hmac.new(b"test", b"inthon-media-v1:" + body, hashlib.sha256).hexdigest()
        self.assertEqual(validate_request(body, signature, "test", now=lambda: 1000), JOB)
        for value, sig, at in [(body + b" ", signature, 1000), (body, signature, 1200), (body, "wrong", 1000)]:
            with self.assertRaises(ValueError):
                validate_request(value, sig, "test", now=lambda: at)
        body = json.dumps({**JOB, "url": "https://localhost/x"}).encode()
        signature = hmac.new(b"test", b"inthon-media-v1:" + body, hashlib.sha256).hexdigest()
        with self.assertRaises(ValueError):
            validate_request(body, signature, "test", now=lambda: 1000)
        body = json.dumps({**JOB, 'directVideo': 'yes'}).encode()
        signature = hmac.new(b'test', b'inthon-media-v1:' + body, hashlib.sha256).hexdigest()
        with self.assertRaises(ValueError):
            validate_request(body, signature, 'test', now=lambda: 1000)

    def test_image_is_normalized_with_actual_jpeg_format_and_bounded_dimensions(self):
        from PIL import Image
        from io import BytesIO
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "input.png"
            Image.new("RGBA", (3000, 2000), (255, 0, 0, 100)).save(path)
            body, size = ai_image(path)
            image = Image.open(BytesIO(body))
            self.assertEqual(image.format, "JPEG")
            self.assertEqual(size, (2048, 1365))
            self.assertLessEqual(len(body), 1536 * 1024)

    def test_all_ten_items_are_staged_in_order_and_retained_for_ai_caller(self):
        from PIL import Image
        output_paths = []
        def download(url, directory, **limits):
            self.assertEqual(limits["max_entries"], 10)
            files = []
            for index in range(1, 11):
                path = Path(directory) / f"image_{index:02d}.jpg"
                Image.new("RGB", (10, 10), (index, 0, 0)).save(path)
                output_paths.append(path)
                files.append({"index": index, "kind": "image", "file": path.name})
            return {"caption": "본문", "files": files}
        blob = SimpleNamespace(put_blob=Mock(), delete_blob=Mock())
        result = prepare_job(JOB, blob, download=download)
        self.assertEqual([f["index"] for f in result["files"]], list(range(1, 11)))
        self.assertEqual(blob.put_blob.call_count, 21)
        self.assertTrue(all(call.kwargs["access"] == "private" for call in blob.put_blob.call_args_list))
        blob.delete_blob.assert_not_called()
        self.assertTrue(all(not path.exists() for path in output_paths))

    def test_partial_upload_error_deletes_only_job_objects_including_ambiguous_write(self):
        from PIL import Image
        def download(url, directory, **limits):
            path = Path(directory) / "image_01.jpg"
            Image.new("RGB", (1, 1)).save(path)
            return {"caption": "", "files": [{"index": 1, "kind": "image", "file": path.name}]}
        blob = SimpleNamespace(put_blob=Mock(side_effect=[None, None, OSError("lost ack")]), delete_blob=Mock())
        with self.assertRaises(OSError):
            prepare_job(JOB, blob, download=download)
        deleted = blob.delete_blob.call_args.args[0]
        self.assertEqual(len(deleted), 3)
        self.assertTrue(all(key.startswith(PREFIX + JOB["jobId"] + "/") for key in deleted))

    def test_duplicate_claim_never_cleans_the_active_job(self):
        blob = SimpleNamespace(put_blob=Mock(side_effect=FileExistsError()), delete_blob=Mock())
        with self.assertRaises(FileExistsError):
            prepare_job(JOB, blob, download=Mock())
        blob.delete_blob.assert_not_called()

    def test_stale_recovery_only_lists_media_and_keeps_active_jobs(self):
        blob = SimpleNamespace(query_blobs=Mock(return_value=[
            SimpleNamespace(pathname=PREFIX + "old/image.jpg", uploaded_at=datetime.fromtimestamp(1, timezone.utc)),
            SimpleNamespace(pathname=PREFIX + "new/image.jpg", uploaded_at=datetime.fromtimestamp(9999, timezone.utc))]), delete_blob=Mock())
        self.assertEqual(purge_stale(blob, now=lambda: 10000), 1)
        blob.query_blobs.assert_called_once_with(prefix=PREFIX)
        blob.delete_blob.assert_called_once_with([PREFIX + "old/image.jpg"])


if __name__ == "__main__":
    unittest.main()
