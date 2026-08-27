"""Read-only helpers for dependency-free extension smoke tests."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Iterable, Mapping, TypedDict


ROOT = Path(__file__).resolve().parents[2]


class ContractCase(TypedDict):
    name: str
    html: list[str]
    sources: dict[str, list[str]]


def read(relative_path: str) -> str:
    path = ROOT / relative_path
    if not path.is_file():
        raise AssertionError(f"Missing file: {relative_path}")
    return path.read_text(encoding="utf-8")


def require_all(content: str, values: Iterable[str], source_name: str) -> None:
    values = list(values)
    missing = [value for value in values if not value.startswith("!") and value not in content]
    forbidden = [value[1:] for value in values if value.startswith("!") and value[1:] in content]
    problems = []
    if missing:
        problems.append("missing " + ", ".join(missing))
    if forbidden:
        problems.append("must not contain " + ", ".join(forbidden))
    if problems:
        raise AssertionError(f"{source_name}: " + "; ".join(problems))


def run_checks(checks: Mapping[str, object]) -> None:
    """Print every result, then fail once so all regressions stay visible."""
    failures = []
    for name, condition in checks.items():
        passed = bool(condition)
        print(f"  {'PASS' if passed else 'FAIL'} {name}")
        if not passed:
            failures.append(name)
    if failures:
        raise SystemExit(1)


class CheckCollector:
    """Collect sequential contract checks and report all failures at the end."""

    def __init__(self) -> None:
        self.results: dict[str, bool] = {}

    def __call__(self, name: str, condition: object) -> bool:
        passed = bool(condition)
        self.results[name] = passed
        return passed

    def finish(self) -> None:
        run_checks(self.results)


def verify_contract(
    *,
    page: str,
    html: Iterable[str],
    sources: Mapping[str, Iterable[str]],
    script_prefixes: tuple[str, ...] = (),
) -> None:
    page_html = read(page)
    require_all(page_html, html, page)
    for source, expected in sources.items():
        if source.startswith(script_prefixes):
            require_all(page_html, [f'<script src="{source}"></script>'], page)
        require_all(read(source), expected, source)


def run_contract(
    name: str,
    *,
    page: str,
    html: Iterable[str],
    sources: Mapping[str, Iterable[str]],
    script_prefixes: tuple[str, ...] = (),
) -> None:
    try:
        verify_contract(
            page=page,
            html=html,
            sources=sources,
            script_prefixes=script_prefixes,
        )
    except AssertionError as error:
        print(f"[FAIL] {name}: {error}", file=sys.stderr)
        raise SystemExit(1)
    print(f"[OK] {name}")


def run_page_contract(
    name: str,
    *,
    page: str,
    html: Iterable[str],
    sources: Mapping[str, Iterable[str]],
) -> None:
    run_contract(
        name,
        page=page,
        html=html,
        sources=sources,
        script_prefixes=("js/",),
    )


def run_popup_contract(
    name: str,
    *,
    html: Iterable[str],
    sources: Mapping[str, Iterable[str]],
) -> None:
    run_contract(
        name,
        page="popup.html",
        html=html,
        sources=sources,
        script_prefixes=("js/popup/",),
    )


def run_popup_contracts(cases: Iterable[ContractCase]) -> None:
    cases = list(cases)
    failures = []
    for case in cases:
        try:
            verify_contract(
                page="popup.html",
                html=case["html"],
                sources=case["sources"],
                script_prefixes=("js/popup/",),
            )
            print(f"  PASS {case['name']}")
        except AssertionError as error:
            failures.append(f"{case['name']}: {error}")
            print(f"  FAIL {case['name']}: {error}", file=sys.stderr)
    if failures:
        raise SystemExit(1)
    print(f"[OK] {len(cases)} popup contracts")
