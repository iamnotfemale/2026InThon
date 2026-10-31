import importlib.util
import io
import json
import os
import sys
import threading
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('media_api', Path(__file__).parents[1] / 'api' / 'media.py')
media_api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(media_api)


class MediaApiChecks(unittest.TestCase):
    def test_single_complete_video_returns_only_metadata_without_staging(self):
        response = []
        data = {'url': 'https://www.instagram.com/reel/Example/', 'directVideo': True}
        video = {'url': 'https://video.example.fbcdn.net/full.mp4', 'contentType': 'video/mp4'}
        request = SimpleNamespace(headers={'content-length': '2'}, rfile=io.BytesIO(b'{}'),
                                  respond=lambda status, value: response.append((status, value)))
        with patch.dict(sys.modules, {'vercel.blob': SimpleNamespace(sync=object())}), \
                patch.object(media_api, 'validate_request', return_value=data), \
                patch.object(media_api, 'purge_stale') as purge, \
                patch.object(media_api.downloader, 'resolve_video', return_value=({'description': '본문'}, video)) as resolve, \
                patch.object(media_api, 'prepare_job') as prepare, redirect_stdout(io.StringIO()):
            media_api.handler.do_POST(request)
        self.assertEqual(response[0][0], 200)
        self.assertEqual(response[0][1]['caption'], '본문')
        self.assertEqual(response[0][1]['video'], video)
        self.assertNotIn('files', response[0][1])
        resolve.assert_called_once_with(data['url'])
        purge.assert_called_once()
        prepare.assert_not_called()

    def test_non_single_video_reuses_all_extracted_metadata_for_complete_staging(self):
        response = []
        data = {'url': 'https://www.instagram.com/p/Example/', 'directVideo': True}
        info = {'entries': [{'id': 'one'}, {'id': 'two'}]}
        def prepare(value, blob, download):
            self.assertIs(download.keywords['info'], info)
            return {'sourceUrl': data['url'], 'files': [{'index': 1}, {'index': 2}], 'timings': {}}
        request = SimpleNamespace(headers={'content-length': '2'}, rfile=io.BytesIO(b'{}'),
                                  respond=lambda status, value: response.append((status, value)))
        with patch.dict(sys.modules, {'vercel.blob': SimpleNamespace(sync=object())}), \
                patch.object(media_api, 'validate_request', return_value=data), \
                patch.object(media_api, 'purge_stale'), \
                patch.object(media_api.downloader, 'resolve_video', return_value=(info, None)) as resolve, \
                patch.object(media_api, 'prepare_job', side_effect=prepare), redirect_stdout(io.StringIO()):
            media_api.handler.do_POST(request)
        resolve.assert_called_once()
        self.assertEqual(response[0][0], 200)
        self.assertEqual(len(response[0][1]['files']), 2)

    def test_stale_recovery_overlaps_preparation_and_both_finish_before_response(self):
        purge_started, prepare_started = threading.Event(), threading.Event()
        finished = []
        response = []
        def purge(blob):
            purge_started.set()
            self.assertTrue(prepare_started.wait(5))
            finished.append('purge')
        def prepare(data, blob):
            prepare_started.set()
            self.assertTrue(purge_started.wait(5))
            finished.append('prepare')
            return {'timings': {'stage_ms': 1}, 'files': []}
        request = SimpleNamespace(headers={'content-length': '2'}, rfile=io.BytesIO(b'{}'),
                                  respond=lambda status, value: response.append((status, value, sorted(finished))))
        with patch.dict(sys.modules, {'vercel.blob': SimpleNamespace(sync=object())}), \
                patch.object(media_api, 'validate_request', return_value={}), \
                patch.object(media_api, 'purge_stale', side_effect=purge), \
                patch.object(media_api, 'prepare_job', side_effect=prepare), redirect_stdout(io.StringIO()) as output:
            media_api.handler.do_POST(request)
        self.assertEqual(response[0][0], 200)
        self.assertEqual(response[0][2], ['prepare', 'purge'])
        record = json.loads(output.getvalue())
        self.assertEqual(record['event'], 'MEDIA_PREP_TIMING')
        self.assertTrue(all(isinstance(value, int) for key, value in record.items() if key.endswith('_ms')))


if __name__ == '__main__':
    unittest.main()
