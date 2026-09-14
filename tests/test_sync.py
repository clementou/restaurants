import unittest
from sync_beli import normalize


def row(identifier, category, score):
    return {"id": identifier, "category": category, "score": score,
            "user": "private-user-id", "visit_dates": ["private-date"],
            "business": {"id": identifier, "name": "Test", "lat": 48, "lng": 2}}


class ExportTests(unittest.TestCase):
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
