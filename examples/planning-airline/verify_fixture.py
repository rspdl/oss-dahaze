#!/usr/bin/env python3
"""Compile the airline fixture and its narrow negative mutations with a chosen RSPDL CLI."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--compiler",
        required=True,
        type=Path,
        help="explicit path to the rspdl CLI binary to verify",
    )
    return parser.parse_args()


def compile_source(compiler: Path, source: Path) -> tuple[int, dict[str, Any]]:
    completed = subprocess.run(
        [str(compiler), "compile", str(source), "--json"],
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.stderr:
        print(completed.stderr, file=sys.stderr, end="")
    try:
        report = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise AssertionError(
            f"compiler did not return JSON for {source}: {exc}"
        ) from exc
    return completed.returncode, report


def diagnostic_contract(report: dict[str, Any]) -> list[dict[str, str]]:
    return [
        {
            "rule_id": item["rule_id"],
            "severity": item["severity"],
            "message_key": item["message_key"],
        }
        for item in report.get("diagnostics", [])
    ]


def walk_elements(elements: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for element in elements:
        result.append(element)
        result.extend(walk_elements(element.get("children", element.get("inputs", []))))
    return result


def verify_counts(module: dict[str, Any], expected: dict[str, int]) -> None:
    elements = [
        element
        for layout in module["screen_layouts"]
        for element in walk_elements(layout["elements"])
    ]
    actual = {
        "models": len(module["models"]),
        "roles": len(module["roles"]),
        "actions": len(module["actions"]),
        "screens": len(module["screens"]),
        "screen_layouts": len(module["screen_layouts"]),
        "screen_elements": len(elements),
        "screen_elements_without_id": sum(
            element.get("id") is None for element in elements
        ),
        "categories": len(module["information_architecture"]),
        "screen_category_assignments": len(module["screen_categories"]),
        "screen_permissions": sum(
            len(layout.get("permissions", [])) for layout in module["screen_layouts"]
        ),
        "screen_paths": len(module["screen_paths"]),
        "action_outcomes": len(module["action_outcomes"]),
        "lookup_results": len(module["lookup_results"]),
        "workflows": len(module["workflows"]),
    }
    if actual != expected:
        raise AssertionError(
            f"fixture counts changed\nexpected={expected}\nactual={actual}"
        )


def verify_metadata(module: dict[str, Any], document_path: str) -> None:
    metadata = json.loads((ROOT / "planning-metadata.json").read_text())
    screen_keys = {f"{document_path}:{screen['id']}" for screen in module["screens"]}
    selected = {
        key
        for environment in metadata["environments"]
        if environment["screenMode"] == "selected"
        for key in environment["screenKeys"]
    }
    if selected != screen_keys:
        raise AssertionError(
            "environment screen keys must cover every compiled screen exactly by stable key\n"
            f"missing={sorted(screen_keys - selected)}\nunknown={sorted(selected - screen_keys)}"
        )

    fields_by_model = {
        model["id"]: {field["id"] for field in model["fields"]}
        for model in module["models"]
    }
    samples = metadata["sample_data"]["models"]
    if set(samples) != set(fields_by_model):
        raise AssertionError("sample model IDs do not match the compiled model IDs")
    for model_id, variants in samples.items():
        if set(variants) != {"normal", "empty", "long", "many"}:
            raise AssertionError(f"{model_id} does not define all four sample variants")
        for rows in variants.values():
            for row in rows:
                unknown = set(row["values"]) - fields_by_model[model_id]
                if unknown:
                    raise AssertionError(
                        f"{model_id} sample has unknown fields: {sorted(unknown)}"
                    )


def apply_variant(source: str, variant: dict[str, Any]) -> str:
    candidate = source
    for replacement in variant["replacements"]:
        before = replacement["before"]
        if candidate.count(before) != 1:
            raise AssertionError(
                f"{variant['id']} replacement must match exactly once, got {candidate.count(before)}"
            )
        candidate = candidate.replace(before, replacement["after"], 1)
    return candidate


def main() -> int:
    args = parse_args()
    compiler = args.compiler.resolve()
    if not compiler.is_file():
        raise SystemExit(f"compiler does not exist: {compiler}")

    fixture = json.loads((ROOT / "fixture.json").read_text())
    source_path = ROOT / fixture["document"]
    code, report = compile_source(compiler, source_path)
    if code != 0 or diagnostic_contract(report):
        raise AssertionError(
            f"positive fixture must compile without diagnostics: exit={code}, "
            f"diagnostics={diagnostic_contract(report)}"
        )
    module = report.get("module")
    if not isinstance(module, dict):
        raise TypeError("positive fixture did not produce a module")
    verify_counts(module, fixture["expected_counts"])
    verify_metadata(module, fixture["project_document_path"])
    print(
        f"positive: ok ({fixture['expected_counts']['screens']} screens, 0 diagnostics)"
    )

    source = source_path.read_text()
    variants = json.loads((ROOT / "variants.json").read_text())
    with tempfile.TemporaryDirectory(prefix="planning-airline-") as directory:
        temp = Path(directory)
        for variant in variants:
            candidate = temp / f"{variant['id']}.rspdl"
            candidate.write_text(apply_variant(source, variant))
            code, report = compile_source(compiler, candidate)
            actual = diagnostic_contract(report)
            if code != 1 or actual != variant["expected_diagnostics"]:
                raise AssertionError(
                    f"{variant['id']} diagnostic contract changed: exit={code}, "
                    f"expected={variant['expected_diagnostics']}, actual={actual}"
                )
            expected = variant["expected_diagnostics"][0]
            print(f"negative/{variant['id']}: ok ({expected['rule_id']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
