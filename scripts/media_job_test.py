import hashlib
import hmac
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

from media_job import validate_request, prepare_job, ai_image, purge_stale, PREFIX

JOB = {"jobId": "11111111-1111-4111-8111-111111111111", "at": 1000,
       "url": "https://www.instagram.com/p/Example/"}


class MediaJobChecks(unittest.TestCase):
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
