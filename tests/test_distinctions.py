import unittest

from sync_distinctions import parse_michelin, parse_fifty, parse_fifty_archive


class DistinctionTests(unittest.TestCase):
    def edition(self, year, series="Restaurants", count=50):
        return f"<h1>The World's 50 Best {series} {year}</h1>" + ''.join(
            f'<div class="list-item"><p class="rank ">{rank}</p><h2>Place {rank}</h2><p>Paris</p></div>'
            for rank in range(1, count + 1))

    def test_archive_keeps_each_year_and_distinguishes_bars(self):
        rows = parse_fifty_archive(self.edition(2002) + self.edition(2003), "restaurants")
        self.assertEqual(len(rows), 100)
        self.assertEqual(len({r["id"] for r in rows}), 100)
        bars = parse_fifty_archive(self.edition(2009, "Bars"), "bars")
        self.assertEqual(bars[0]["kind"], "world50bars")
        self.assertIn("/2009", bars[0]["url"])
        with self.assertRaises(ValueError):
            parse_fifty_archive(self.edition(2002) + self.edition(2004), "restaurants")

    def test_archive_corrections_are_explicit_and_validated(self):
        broken = self.edition(2009, "Bars").replace('>30</p>', '>29</p>')
        with self.assertRaises(ValueError):
            parse_fifty_archive(broken, "bars")
        correction = {"series": "bars", "year": 2009, "name": "Place 30", "from": 29, "rank": 30, "source": "https://example.com/original.pdf"}
        rows = parse_fifty_archive(broken, "bars", [correction])
        self.assertEqual(rows[29]["rank"], 30)
        self.assertEqual(rows[29]["url"], correction["source"])
        self.assertIn("/2009", rows[29]["archiveUrl"])
        with self.assertRaises(ValueError):
            parse_fifty_archive(broken, "bars", [{**correction, "from": 28}])

    def test_only_restaurant_2020_is_an_expected_gap(self):
        html = ''.join(self.edition(y) for y in range(2002, 2022) if y != 2020)
        self.assertEqual(len(parse_fifty_archive(html, "restaurants")), 19 * 50)
        with self.assertRaises(ValueError):
            parse_fifty_archive(self.edition(2009, "Bars") + self.edition(2011, "Bars"), "bars")

    def test_michelin_extracts_facts_and_ignores_recommendations(self):
        html = '''<h1>1-1 of 1 restaurants</h1>
        <div class="js-restaurant__list_item" data-id="123" data-map-pin-name="BIB_GOURMAND" data-lat="37.7" data-lng="-122.4">
          <div data-restaurant-name="Café &amp; One" data-dtm-city="San Francisco" data-restaurant-country="us"></div>
          <a href="/us/en/california/san-francisco/restaurant/cafe-one">Cafe</a>
        </div>
        <div class="js-restaurant__list_item js-restaurants__empty_new_restaurants" data-id="456" data-map-pin-name=""></div>'''
        rows, count = parse_michelin(html)
        self.assertEqual(count, 1)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["name"], "Café & One")
        self.assertEqual(rows[0]["stars"], 0)
        self.assertEqual(rows[0]["id"], "michelin:123")

    def test_challenges_and_missing_lists_fail(self):
        for parser in (parse_michelin, parse_fifty):
            with self.assertRaises(ValueError):
                parser("<html>Enable JavaScript to verify</html>")

    def test_fifty_requires_complete_ranks_and_edition(self):
        header = '<meta name="list-year" content="2025">'
        items = ''.join(f'<div class="list-item"><p class="rank ">{rank}</p><h2>Place {rank}</h2><p>Paris</p></div>' for rank in range(1, 101))
        rows = parse_fifty(header + items)
        self.assertEqual(len(rows), 100)
        self.assertEqual(rows[-1]["rank"], 100)
        self.assertEqual(rows[-1]["year"], 2025)
        with self.assertRaises(ValueError):
            parse_fifty(header + items.replace('>100</p>', '>99</p>'))
        with self.assertRaises(ValueError):
            parse_fifty(items)
