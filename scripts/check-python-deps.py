#!/usr/bin/env python3
"""Guard against drift between the two Python dependency lists.

Vercel installs the Python Function from the root `requirements.txt`. The tests
and local development install from `parser/requirements.txt`. Nothing links
them, so a package can be present where the tests run and absent where
production runs — which is exactly how `xlrd` was missed: it was only ever
installed locally as a transitive dependency, so ABSL's `.xls` months parsed on
a dev machine and failed in production.

Root must cover everything the parser needs at runtime. `reportlab` is the one
sanctioned exception: it only generates test fixtures and would bloat the
function bundle.
"""
import re
import sys
from pathlib import Path

RUNTIME_ONLY_EXCEPTIONS = {"reportlab"}


def read(path):
    """Map normalised package name -> raw requirement line."""
    out = {}
    for raw in Path(path).read_text().splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        name = re.split(r"[<>=!~\[;]", line, 1)[0].strip().lower().replace("_", "-")
        if name:
            out[name] = line
    return out


def main():
    root = read("requirements.txt")
    parser = read("parser/requirements.txt")

    missing = sorted(set(parser) - set(root) - RUNTIME_ONLY_EXCEPTIONS)
    if missing:
        print("requirements.txt is missing packages that parser/requirements.txt has:")
        for name in missing:
            print(f"  - {parser[name]}")
        print(
            "\nThe Python Function installs from requirements.txt, so anything only\n"
            "listed in parser/requirements.txt works in tests and fails in production."
        )
        return 1

    # Pins that disagree are just as bad: the tests would exercise a different
    # version from the one deployed.
    conflicts = [
        (name, parser[name], root[name])
        for name in sorted(set(parser) & set(root))
        if parser[name] != root[name]
    ]
    if conflicts:
        print("Version specifiers disagree between the two requirements files:")
        for name, p, r in conflicts:
            print(f"  {name}: parser={p!r} root={r!r}")
        return 1

    print(f"python deps consistent ({len(parser)} packages checked)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
