import unittest
import base64
import json
import io
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch, MagicMock
from urllib.error import HTTPError, URLError
from sync_beli import CATEGORIES, LoginError, credentials, fetch_ranking, login, main, normalize


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


class AuthenticationTests(unittest.TestCase):
    def test_login_uses_password_and_needs_only_access_token(self):
        opener = MagicMock()
        opener.open.return_value.__enter__.return_value = io.StringIO('{"access":"new-access"}')
        with patch("sync_beli.build_opener", return_value=opener):
            self.assertEqual(login("+14155551234", "test-password"), "new-access")
        request = opener.open.call_args.args[0]
        self.assertTrue(request.full_url.endswith("/api/token/"))
        self.assertEqual(json.loads(request.data), {"phone_no": "+14155551234", "password": "test-password"})

    def test_login_errors_are_actionable_without_exposing_response(self):
        for status, expected in [(401, "BELI_PASSWORD"), (429, "rate-limited"), (503, "HTTP 503"), (302, "HTTP 302")]:
            with self.subTest(status=status):
                opener = MagicMock()
                opener.open.side_effect = HTTPError("https://example.invalid", status, "private-response", {}, io.BytesIO(b"private-response"))
                with patch("sync_beli.build_opener", return_value=opener):
                    with self.assertRaises(LoginError) as raised:
                        login("+14155551234", "test-password")
                message = str(raised.exception)
                self.assertIn(expected, message)
                self.assertNotIn("private-response", message)
                self.assertNotIn("test-password", message)
                self.assertNotIn("+14155551234", message)

    def test_invalid_login_responses(self):
        for body in ['not-json', '[]', '{}', '{"access":null}', '{"access":""}']:
            opener = MagicMock()
            opener.open.return_value.__enter__.return_value = io.StringIO(body)
            with patch("sync_beli.build_opener", return_value=opener):
                with self.assertRaises(LoginError):
                    login("+14155551234", "test-password")
        opener.open.side_effect = URLError("private-detail")
        with patch("sync_beli.build_opener", return_value=opener):
            with self.assertRaisesRegex(LoginError, "Could not reach Beli"):
                login("+14155551234", "test-password")

    def test_noninteractive_credentials_fail_before_network(self):
        for env in [{}, {"BELI_PHONE": "+14155551234"}, {"BELI_PASSWORD": "test-password"}]:
            with patch.dict("os.environ", env, clear=True), \
                 patch("sys.stdin.isatty", return_value=False), \
                 patch("sync_beli.getpass.getpass") as prompt:
                with self.assertRaisesRegex(LoginError, "Set both BELI_PHONE and BELI_PASSWORD"):
                    credentials()
                prompt.assert_not_called()

    def test_credentials_preserve_password_and_normalize_phone(self):
        with patch.dict("os.environ", {"BELI_PHONE": "+1 (415) 555-1234", "BELI_PASSWORD": " spaced password "}, clear=True):
            self.assertEqual(credentials(), ("+14155551234", " spaced password "))

    def test_all_categories_use_fresh_access(self):
        claims = base64.urlsafe_b64encode(b'{"user_id":"test"}').decode().rstrip("=")
        access = f"header.{claims}.signature"
        with patch("sync_beli.fetch_category", side_effect=lambda a, u, c: [c]) as fetch:
            self.assertEqual(fetch_ranking(access), list(CATEGORIES))
        self.assertEqual(
            [call.args for call in fetch.call_args_list],
            [(access, "test", category) for category in CATEGORIES],
        )

    def test_failed_login_or_fetch_leaves_snapshot_untouched(self):
        for failure in ("login", "fetch_ranking"):
            with self.subTest(failure=failure), TemporaryDirectory() as directory:
                public = Path(directory)
                for name in ("data.json", "restaurants.csv"):
                    (public / name).write_text("previous snapshot")
                with patch("sys.argv", ["sync_beli.py"]), \
                     patch("sync_beli.PUBLIC", public), \
                     patch("sync_beli.credentials", return_value=("phone", "password")), \
                     patch("sync_beli.login", return_value="access") as auth, \
                     patch("sync_beli.fetch_ranking") as fetch, \
                     patch("sys.stderr", new_callable=io.StringIO) as stderr:
                    if failure == "login":
                        auth.side_effect = LoginError("Credentials rejected")
                    else:
                        fetch.side_effect = HTTPError("url", 503, "private-detail", {}, None)
                    self.assertEqual(main(), 1)
                    self.assertNotIn("private-detail", stderr.getvalue())
                    if failure == "login":
                        fetch.assert_not_called()
                self.assertEqual(sorted(p.name for p in public.iterdir()), ["data.json", "restaurants.csv"])
                for path in public.iterdir():
                    self.assertEqual(path.read_text(), "previous snapshot")


if __name__ == "__main__":
    unittest.main()
