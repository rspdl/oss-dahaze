#!/usr/bin/env python3
"""Seed the airline fixture into a new, isolated dahaze project through public REST APIs."""

from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
from datetime import UTC, datetime
from http.cookiejar import CookieJar
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.parse import urljoin
from urllib.request import HTTPCookieProcessor, Request, build_opener

ROOT = Path(__file__).resolve().parent


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--base-url",
        default=os.environ.get("DAHAZE_BASE_URL"),
        help="dahaze API origin; may also be set with DAHAZE_BASE_URL",
    )
    parser.add_argument("--login", default=os.environ.get("DAHAZE_SEED_LOGIN"))
    parser.add_argument("--password", default=os.environ.get("DAHAZE_SEED_PASSWORD"))
    parser.add_argument(
        "--display-name",
        default=os.environ.get("DAHAZE_SEED_DISPLAY_NAME", "항공 기획 검증 계정"),
    )
    parser.add_argument(
        "--register-fake-account",
        action="store_true",
        help="register the supplied fake credentials instead of logging in",
    )
    parser.add_argument(
        "--project-slug",
        help="slug for the new project; omitted means a unique planning-airline-* slug",
    )
    parser.add_argument("--project-name", default="별하늘 항공 예약 기획 검증")
    args = parser.parse_args()
    missing = [
        name
        for name, value in (
            ("--base-url or DAHAZE_BASE_URL", args.base_url),
            ("--login or DAHAZE_SEED_LOGIN", args.login),
            ("--password or DAHAZE_SEED_PASSWORD", args.password),
        )
        if not value
    ]
    if missing:
        parser.error("missing " + ", ".join(missing))
    return args


class Client:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/") + "/"
        self.opener = build_opener(HTTPCookieProcessor(CookieJar()))

    def request(
        self, method: str, path: str, body: dict[str, Any] | None = None
    ) -> Any:
        payload = None if body is None else json.dumps(body).encode()
        request = Request(
            urljoin(self.base_url, path.lstrip("/")),
            data=payload,
            method=method,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        try:
            with self.opener.open(request) as response:
                raw = response.read()
        except HTTPError as exc:
            detail = exc.read().decode(errors="replace")
            raise RuntimeError(
                f"{method} {path} failed with HTTP {exc.code}: {detail}"
            ) from exc
        return None if not raw else json.loads(raw)


def diagnostics(result: dict[str, Any]) -> list[dict[str, Any]]:
    if isinstance(result.get("diagnostics"), list):
        return result["diagnostics"]
    return [
        diagnostic
        for file in result.get("files", [])
        for diagnostic in file.get("diagnostics", [])
    ]


def main() -> int:
    args = parse_args()
    client = Client(args.base_url)
    source = (ROOT / "airline-planning.rspdl").read_text()
    metadata = json.loads((ROOT / "planning-metadata.json").read_text())

    # This read-only compile gate runs before account or project mutation. An older server that
    # does not understand the C3 contract stops here and leaves no partial seed project behind.
    preflight = client.request(
        "POST",
        "/api/analysis/compile",
        {"sources": [{"path": "airline-planning.rspdl", "text": source}]},
    )
    preflight_diagnostics = diagnostics(preflight["result"])
    if preflight_diagnostics:
        evidence = [
            {
                "rule_id": item.get("rule_id"),
                "severity": item.get("severity"),
                "message_key": item.get("message_key"),
            }
            for item in preflight_diagnostics
        ]
        raise RuntimeError(
            "server compiler rejected the fixture before seeding; restart with the intended "
            f"compiler contract. diagnostics={evidence}"
        )

    credentials = {"login": args.login, "password": args.password}
    if args.register_fake_account:
        client.request(
            "POST",
            "/api/auth/register",
            {**credentials, "display_name": args.display_name},
        )
    else:
        client.request("POST", "/api/auth/login", credentials)

    slug = args.project_slug or (
        "planning-airline-"
        + datetime.now(UTC).strftime("%Y%m%d-%H%M%S-")
        + secrets.token_hex(2)
    )
    project = client.request(
        "POST",
        "/api/projects",
        {
            "slug": slug,
            "name": args.project_name,
            "description": (
                "가상 항공사 별하늘 항공의 PC·모바일 고객 예약과 운영 업무 통합 검증용 프로젝트"
            ),
        },
    )
    project_id = project["id"]
    client.request(
        "POST",
        f"/api/projects/{project_id}/documents",
        {
            "path": "airline-planning.rspdl",
            "title": "별하늘 항공 예약 기획",
            "text": source,
        },
    )
    state = client.request("GET", f"/api/projects/{project_id}/planning")
    client.request(
        "PATCH",
        f"/api/projects/{project_id}/planning/metadata",
        {
            "expected_revision": state["revision"],
            "environments": metadata["environments"],
            "design": metadata["design"],
            "sample_data": metadata["sample_data"],
            "summary": "별하늘 항공 환경과 정상·빈·긴 문구·많은 데이터 샘플 등록",
        },
    )
    compiled = client.request("GET", f"/api/projects/{project_id}/compile")
    final_diagnostics = diagnostics(compiled["result"])
    if final_diagnostics:
        raise RuntimeError(
            f"seeded project compiled with diagnostics: {final_diagnostics}"
        )

    print(json.dumps({"project_id": project_id, "slug": slug}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, RuntimeError) as exc:
        print(f"seed failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
