import csv
import io
import json
from pathlib import Path
import tarfile
from tempfile import TemporaryDirectory
import unittest
from sync_google_maps import parse_list, read_archive, write_export


def csv_data(rows):
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(['Title', 'Note', 'URL', 'Tags', 'Comment'])
    writer.writerows(rows)
    return out.getvalue().encode()


class GoogleMapsTests(unittest.TestCase):
    def test_private_fields_are_excluded_and_ids_are_stable(self):
        data = csv_data([['', '', '', '', ''], ['Cafe', 'private note',
                         'https://www.google.com/maps/place/Cafe/data=!1s0x123:0xabc', 'private tag', 'private comment']])
        places = parse_list(data)
        self.assertEqual(len(places), 1)
        self.assertEqual(places[0]['id'], 'google-abc')
        self.assertNotIn('private', json.dumps(places))
        self.assertIsNone(places[0]['score'])
        self.assertIsNone(places[0]['lat'])
        self.assertIsNone(places[0]['addedAt'])

    def test_only_want_to_go_is_read_without_extracting_paths(self):
        out = io.BytesIO()
        with tarfile.open(fileobj=out, mode='w:gz') as archive:
            for name in ['Takeout/Saved/Favorite places.csv', 'Takeout/Saved/Want to go.csv']:
                content = csv_data([[name, '', 'https://www.google.com/maps/place/Test', '', '']])
                info = tarfile.TarInfo(name)
                info.size = len(content)
                archive.addfile(info, io.BytesIO(content))
        self.assertEqual(read_archive(out.getvalue())[0]['name'], 'Takeout/Saved/Want to go.csv')

    def test_empty_or_unsafe_exports_fail_and_unchanged_exports_are_not_rewritten(self):
        for data in [csv_data([]), csv_data([['Test', '', 'https://evil.example/maps', '', '']])]:
            with self.assertRaises(ValueError):
                parse_list(data)
        places = parse_list(csv_data([['Test', '', 'https://www.google.com/maps/place/Test', '', '']]))
        with TemporaryDirectory() as folder:
            path = Path(folder) / 'google-maps.json'
            write_export(places, 'export.tgz', path)
            before = path.read_bytes()
            write_export(places, 'export.tgz', path)
            self.assertEqual(path.read_bytes(), before)
