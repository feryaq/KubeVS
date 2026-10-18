import math
import unittest
from analyze_chain import InputError, analyze

class ChainTests(unittest.TestCase):
    def test_shared_demand_aggregates_before_batch_rounding(self):
        data = {
            "target": {"item": "module", "count": 1},
            "recipes": {
                "module": {"output": {"count": 1}, "ingredients": [{"item": "left", "count": 1}, {"item": "right", "count": 1}]},
                "left": {"output": {"count": 1}, "ingredients": [{"item": "plate", "count": 1}]},
                "right": {"output": {"count": 1}, "ingredients": [{"item": "plate", "count": 1}]},
                "plate": {"output": {"count": 3}, "ingredients": [{"item": "ore", "count": 2}]}
            }
        }
        result = analyze(data)
        self.assertEqual(result["recipes"]["plate"]["batch_estimate"], 1)
        self.assertEqual(result["raw_inputs"], {"ore": 2})

    def test_expected_stopping_time_is_fractional_when_needed(self):
        result = analyze({"target": {"item": "dust", "count": 1}, "mode": "expected",
                          "recipes": {"dust": {"output": {"count": 3, "chance": 0.5}, "ingredients": [{"item": "ore", "count": 2}]}}})
        row = result["recipes"]["dust"]
        self.assertEqual(row["batch_estimate"], 2)
        self.assertEqual(row["successes_required"], 1)
        self.assertEqual(row["output_units_at_threshold"], 3)
        self.assertEqual(result["raw_inputs"], {"ore": 4})
        self.assertEqual(row["batch_estimate_kind"], "expected trials to threshold")

    def test_guaranteed_mode_rejects_non_guaranteed_producer(self):
        with self.assertRaisesRegex(InputError, "chance-1"):
            analyze({"target": {"item": "dust", "count": 1}, "recipes": {"dust": {"output": {"count": 1, "chance": 0.2}}}})

    def test_cycle_reports_path(self):
        with self.assertRaisesRegex(InputError, r"recipe cycle: a -> b -> a"):
            analyze({"target": {"item": "a", "count": 1}, "recipes": {
                "a": {"output": {"count": 1}, "ingredients": [{"item": "b", "count": 1}]},
                "b": {"output": {"count": 1}, "ingredients": [{"item": "a", "count": 1}]}}})

    def test_catalyst_stock_is_not_scaled_or_summed_across_serial_stages(self):
        result = analyze({"target": {"item": "part", "count": 20}, "recipes": {
            "part": {"output": {"count": 1}, "ingredients": [{"item": "subpart", "count": 1}, {"item": "mold", "count": 2, "kind": "catalyst"}, {"item": "mold", "count": 1, "kind": "catalyst"}], "ticks": 20, "eu_per_tick": 8},
            "subpart": {"output": {"count": 1}, "ingredients": [{"item": "mold", "count": 2, "kind": "catalyst"}], "ticks": 20, "eu_per_tick": 8},
            "mold": {"output": {"count": 1}, "ticks": 40, "eu_per_tick": 32}}})
        self.assertEqual(result["catalyst_stock"], {"mold": 3})
        self.assertNotIn("mold", result["recipes"])
        self.assertIsNotNone(result["totals"]["energy_eu"])

    def test_nominal_ticks_energy_eu_and_machine_count(self):
        result = analyze({"target": {"item": "part", "count": 4, "items_per_second": 0.5}, "recipes": {
            "part": {"output": {"count": 2}, "ingredients": [], "ticks": 40, "eu_per_tick": 32, "parallel_per_machine": 2}}})
        row = result["recipes"]["part"]
        self.assertEqual(row["batch_estimate"], 2)
        self.assertEqual(row["nominal_machine_seconds"], 4)
        self.assertEqual(row["energy_eu"], 2560)
        self.assertEqual(row["machines_for_target_rate"], 1)

    def test_steady_state_machine_counts_follow_stoichiometric_demand(self):
        result = analyze({"target": {"item": "module", "count": 1, "items_per_second": 2}, "recipes": {
            "module": {"output": {"count": 1}, "ingredients": [{"item": "plate", "count": 3}], "ticks": 20, "parallel_per_machine": 1},
            "plate": {"output": {"count": 1}, "ingredients": [], "ticks": 10, "parallel_per_machine": 1}}})
        self.assertEqual(result["recipes"]["module"]["machines_for_target_rate"], 2)
        self.assertEqual(result["recipes"]["plate"]["steady_state_batches_per_second"], 6)
        self.assertEqual(result["recipes"]["plate"]["machines_for_target_rate"], 3)

    def test_unknown_fields_and_invalid_numbers_are_actionable(self):
        with self.assertRaisesRegex(InputError, "unknown field"):
            analyze({"target": {"item": "x", "count": 1}, "wat": 2})
        with self.assertRaisesRegex(InputError, "must be greater than zero"):
            analyze({"target": {"item": "x", "count": 0}})
        with self.assertRaisesRegex(InputError, "finite"):
            analyze({"target": {"item": "x", "count": 1}, "recipes": {"x": {"output": {"count": 1, "chance": math.inf}}}})
        with self.assertRaisesRegex(InputError, "recipes.x.output: unknown field"):
            analyze({"target": {"item": "x", "count": 1}, "recipes": {"x": {"output": {"count": 1, "made_up": 1}}}})
        with self.assertRaisesRegex(InputError, r"recipes.x.ingredients\[0\]: unknown field"):
            analyze({"target": {"item": "x", "count": 1}, "recipes": {"x": {"output": {"count": 1}, "ingredients": [{"item": "ore", "count": 1, "bonus": 2}]}}})

if __name__ == "__main__":
    unittest.main()
