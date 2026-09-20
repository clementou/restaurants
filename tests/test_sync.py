import unittest
import base64
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from sync_beli import fetch_ranking, normalize


def row(identifier, category, score):
    return {"id": identifier, "category": category, "score": score,
            "user": "private-user-id", "visit_dates": ["private-date"],
            "business": {"id": identifier, "name": "Test", "lat": 48, "lng": 2}}


class ExportTests(unittest.TestCase):
    def test_added_date_comes_from_ranking_creation(self):
        source = row(1, "RES", 8)
        source["created_dt"] = "2026-09-19T23:30:00-07:00"
        source["business"]["created_dt"] = "2020-01-01T00:00:00Z"
        place = normalize([source])[0]
        self.assertEqual(place["addedAt"], "2026-09-20T06:30:00+00:00")
        self.assertNotIn("visit_dates", place)
        for value in [None, "invalid", "2026-09-19", 123]:
            source["created_dt"] = value
            self.assertIsNone(normalize([source])[0]["addedAt"])

    def test_rotated_session_survives_failed_fetch(self):
        claims = base64.urlsafe_b64encode(b'{"user_id": "test"}').decode().rstrip("=")
        refreshed = {"access": f"header.{claims}.signature", "refresh": "new-session"}
        with TemporaryDirectory() as directory:
            path = Path(directory) / "tokens.json"
            path.write_text(json.dumps({"refresh": "old-session"}))
            with patch("sync_beli.request_tokens", return_value=refreshed), \
                 patch("sync_beli.fetch_category", side_effect=RuntimeError("offline")):
                with self.assertRaises(RuntimeError):
                    fetch_ranking(path)
            self.assertEqual(json.loads(path.read_text()), refreshed)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_category_ranks_and_private_fields(self):
        places = normalize([row(1, "RES", 8), row(2, "COF", 10), row(3, "RES", 9)])
        self.assertEqual([(p["id"], p["rank"]) for p in places], [(2, 1), (3, 1), (1, 2)])
        for place in places:
            self.assertNotIn("user", place)
            self.assertNotIn("visit_dates", place)

    def test_bad_data_does_not_silently_export(self):
        with self.assertRaises(ValueError):
            normalize([row(1, "RES", float("nan"))])
        with self.assertRaises(ValueError):
            normalize([row(1, "RES", 9), row(1, "RES", 9)])


if __name__ == "__main__":
    unittest.main()
