#!/usr/bin/env python3
"""Assumption-explicit material and steady-state estimate for a recipe DAG."""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any


class InputError(ValueError):
    pass


def obj(value: Any, path: str, allowed: set[str] | None = None) -> dict:
    if not isinstance(value, dict):
        raise InputError(f"{path}: expected object")
    if allowed is not None:
        extra = set(value) - allowed
        if extra:
            raise InputError(f"{path}: unknown field(s): {', '.join(sorted(extra))}")
    return value


def num(value: Any, path: str, *, integer=False, positive=False, maximum=None):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InputError(f"{path}: expected {'integer' if integer else 'number'}")
    if not math.isfinite(value):
        raise InputError(f"{path}: number must be finite")
    if integer and not isinstance(value, int):
        raise InputError(f"{path}: expected integer")
    if positive and value <= 0:
        raise InputError(f"{path}: must be greater than zero")
    if not positive and value < 0:
        raise InputError(f"{path}: must not be negative")
    if maximum is not None and value > maximum:
        raise InputError(f"{path}: must be at most {maximum}")
    return value


def item(value: Any, path: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise InputError(f"{path}: expected non-empty item ID")
    return value


def analyze(data: Any) -> dict:
    root = obj(data, "$", {"target", "mode", "recipes"})
    target = obj(root.get("target"), "target", {"item", "count", "items_per_second"})
    target_item = item(target.get("item"), "target.item")
    target_count = num(target.get("count"), "target.count", integer=True, positive=True)
    target_rate = target.get("items_per_second")
    if target_rate is not None:
        target_rate = num(target_rate, "target.items_per_second", positive=True)
    mode = root.get("mode", "guaranteed")
    if mode not in ("expected", "guaranteed"):
        raise InputError("mode: expected 'expected' or 'guaranteed'")
    recipes = obj(root.get("recipes", {}), "recipes")
    parsed = {}
    for produced, raw in recipes.items():
        item(produced, "recipes key")
        recipe = obj(raw, f"recipes.{produced}", {"output", "ingredients", "ticks", "eu_per_tick", "parallel_per_machine"})
        out = obj(recipe.get("output"), f"recipes.{produced}.output", {"count", "chance"})
        count = num(out.get("count"), f"recipes.{produced}.output.count", integer=True, positive=True)
        chance = num(out.get("chance", 1), f"recipes.{produced}.output.chance", positive=True, maximum=1)
        ingredients = recipe.get("ingredients", [])
        if not isinstance(ingredients, list):
            raise InputError(f"recipes.{produced}.ingredients: expected array")
        ins = []
        for i, raw_ing in enumerate(ingredients):
            path = f"recipes.{produced}.ingredients[{i}]"
            ing = obj(raw_ing, path, {"item", "count", "kind"})
            ing_item = item(ing.get("item"), f"{path}.item")
            amount = num(ing.get("count"), f"{path}.count", integer=True, positive=True)
            kind = ing.get("kind", "consumed")
            if kind not in ("consumed", "catalyst"):
                raise InputError(f"{path}.kind: expected 'consumed' or 'catalyst'")
            ins.append({"item": ing_item, "count": amount, "kind": kind})
        fields = {key: num(recipe[key], f"recipes.{produced}.{key}", integer=True, positive=True)
                  for key in ("ticks", "eu_per_tick", "parallel_per_machine") if key in recipe}
        parsed[produced] = {"count": count, "chance": chance, "ingredients": ins, **fields}

    # Only consumed ingredients create production dependencies. Catalysts are a stock constraint.
    state, postorder, stack = {}, [], []

    def visit(name):
        if name not in parsed:
            return
        if state.get(name) == 1:
            start = stack.index(name)
            raise InputError("recipe cycle: " + " -> ".join(stack[start:] + [name]))
        if state.get(name) == 2:
            return
        state[name] = 1
        stack.append(name)
        for ing in parsed[name]["ingredients"]:
            if ing["kind"] == "consumed":
                visit(ing["item"])
        stack.pop()
        state[name] = 2
        postorder.append(name)

    visit(target_item)
    order = list(reversed(postorder))  # parents first, after all shared demands can be aggregated
    demand, demand_rate, batches, batch_rates, catalysts = {target_item: target_count}, {}, {}, {}, {}
    if target_rate is not None:
        demand_rate[target_item] = target_rate
    unavailable = []
    for name in order:
        needed = demand.get(name, 0)
        recipe = parsed[name]
        chance = recipe["chance"]
        if mode == "guaranteed" and chance < 1:
            unavailable.append(name)
            continue
        successes = math.ceil(needed / recipe["count"])
        # Expected stopping time for successes independent Bernoulli batches: E[N] = k / p.
        runs = successes / chance if mode == "expected" else successes
        batches[name] = runs
        if name in demand_rate:
            output_rate = demand_rate[name]
            if chance < 1 and mode == "guaranteed":
                unavailable.append(name)
            else:
                batch_rate = output_rate / (recipe["count"] * chance)
                batch_rates[name] = batch_rate
        else:
            batch_rate = None
        stage_catalysts = {}
        for ing in recipe["ingredients"]:
            if ing["kind"] == "catalyst":
                stage_catalysts[ing["item"]] = stage_catalysts.get(ing["item"], 0) + ing["count"]
                continue
            demand[ing["item"]] = demand.get(ing["item"], 0) + ing["count"] * runs
            if batch_rate is not None:
                demand_rate[ing["item"]] = demand_rate.get(ing["item"], 0) + ing["count"] * batch_rate
        for catalyst_item, amount in stage_catalysts.items():
            catalysts[catalyst_item] = max(catalysts.get(catalyst_item, 0), amount)
    if unavailable:
        raise InputError("guaranteed mode requires chance-1 recipes for: " + ", ".join(sorted(set(unavailable))))

    raw = {name: amount for name, amount in demand.items() if name not in parsed}
    rows, energy, all_ticks, all_energy = {}, 0, True, True
    sequential_seconds = 0
    for name in order:
        if name not in batches:
            continue
        recipe = parsed[name]
        runs = batches[name]
        successes = math.ceil(demand[name] / recipe["count"])
        row = {"batch_estimate": runs,
               "batch_estimate_kind": "expected trials to threshold" if mode == "expected" else "guaranteed batches",
               "successes_required": successes,
               "output_units_at_threshold": successes * recipe["count"],
               "chance_per_batch": recipe["chance"]}
        if mode == "guaranteed":
            row["guaranteed_output_units_at_target"] = successes * recipe["count"]
        if "ticks" in recipe:
            row["nominal_machine_seconds"] = runs * recipe["ticks"] / 20
            sequential_seconds += row["nominal_machine_seconds"]
        else:
            all_ticks = False
        if "ticks" in recipe and "eu_per_tick" in recipe:
            row["energy_eu"] = runs * recipe["ticks"] * recipe["eu_per_tick"]
            energy += row["energy_eu"]
        else:
            all_energy = False
        batch_rate = batch_rates.get(name)
        if batch_rate is not None:
            row["steady_state_batches_per_second"] = batch_rate
            if "ticks" in recipe and "parallel_per_machine" in recipe:
                per_machine = recipe["parallel_per_machine"] / (recipe["ticks"] / 20)
                row["machines_for_target_rate"] = math.ceil(batch_rate / per_machine)
        rows[name] = row
    return {
        "mode": mode,
        "target": {"item": target_item, "count": target_count, **({"items_per_second": target_rate} if target_rate is not None else {})},
        "raw_inputs": dict(sorted(raw.items())),
        "catalyst_stock": dict(sorted(catalysts.items())),
        "recipes": dict(sorted(rows.items())),
        "totals": {"nominal_sequential_machine_seconds": sequential_seconds if all_ticks else None,
                   "energy_eu": energy if all_energy else None},
        "assumptions": [
            "Shared consumed demand is aggregated before item-level batch rounding.",
            "Expected mode uses E[N]=ceil(demand/output_count)/chance for independent Bernoulli batches; estimates can be fractional and are not guarantees.",
            "Guaranteed mode uses chance-1 recipes; guaranteed output fields apply only in this mode.",
            "Cascaded stochastic demand with batch rounding uses propagated means: not an exact expectation or a confidence guarantee.",
            "Catalyst stock is the maximum reusable amount needed across serial stages; parallel machine stock may be higher.",
            "Time assumes nominal 20 TPS; summed chain time assumes serial stages and is not wall-clock runtime.",
            "Energy remains in EU; downtime, speed modifiers, and missing inputs are excluded.",
            "Single-output recipes only; byproducts are excluded from demand and must be modelled separately without double-counting their reuse."
        ]
    }


def main(argv):
    if len(argv) != 2:
        print("Usage: analyze_chain.py INPUT.json", file=sys.stderr)
        return 2
    try:
        result = analyze(json.loads(Path(argv[1]).read_text(encoding="utf-8")))
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except (OSError, json.JSONDecodeError, InputError) as exc:
        print(f"analyze_chain: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
