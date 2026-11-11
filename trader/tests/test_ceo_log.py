import datetime as dt, json, os, tempfile, unittest
from aitrader import ceo_log


class CeoLogTest(unittest.TestCase):
    def test_flags_only_held_elevated_or_high(self):
        ceo = [{"name": "A", "ticker": "NVDA", "score": -9, "key_man_risk": "High"},
               {"name": "B", "ticker": "AMD", "score": 2, "key_man_risk": "Low"},
               {"name": "C", "ticker": "AVGO", "score": -1, "key_man_risk": "Elevated"}]
        state = {"sleeves": {"B": {"shares": {"NVDA": 0.1, "AMD": 0.2}}, "A": {"shares": {"AVGO": 0}}}}
        out = ceo_log.build(ceo, state, dt.date(2026, 11, 10))
        self.assertTrue(out["informational_only"]); self.assertEqual(out["count"], 3)
        self.assertEqual(list(out["held_flagged"]), ["B"])
        self.assertEqual(out["held_flagged"]["B"][0]["symbol"], "NVDA")

    def test_insufficient_is_missing_not_neutral(self):
        ceo = [{"name": "X", "ticker": "SMCI", "score": None, "key_man_risk": "insufficient"},
               {"name": "Y", "ticker": "AMD", "score": 0, "key_man_risk": "Low"},
               {"name": "Z", "ticker": "ARM", "score": None, "key_man_risk": "Not enough coverage"}]
        out = ceo_log.build(ceo, {"sleeves": {"B": {"shares": {"SMCI": 1}}}}, dt.date(2026, 11, 10))
        self.assertEqual((out["scored"], out["missing"]), (1, 2))
        self.assertTrue(out["ceo"][0]["missing"]); self.assertFalse(out["ceo"][1]["missing"]); self.assertTrue(out["ceo"][2]["missing"])
        self.assertEqual(out["held_flagged"], {})

    def test_write_handles_missing_feed(self):
        with tempfile.TemporaryDirectory() as d:
            f, out = ceo_log.write(d, None, None, dt.date(2026, 11, 10))
            self.assertTrue(os.path.exists(f)); self.assertEqual(out["count"], 0)
            self.assertEqual(json.load(open(f))["held_flagged"], {})


if __name__ == "__main__": unittest.main()
