"""Shared Stripe secret shape checks for Nitrogen AI local/prod wiring.

Used by sync_prod_secrets_to_local.sh (--check-kv) and unit tests so
placeholder / unsuffixed STRIPE_* keys cannot silently break Subscribe /
Manage portal.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Iterable

# Railway / Cursor must use the _NITROGEN suffix only for Stripe.
PLAIN_STRIPE_KEY_RE = re.compile(
    r"^STRIPE_(SECRET_KEY|PRICE_ID|WEBHOOK_SECRET|PUBLISHABLE_KEY|RESTRICTED_KEY)$"
)


def is_placeholder_stripe_secret(value: str | None) -> bool:
    if not value:
        return True
    if value.startswith("sk_test_local") or value.startswith("sk_live_local"):
        return True
    lowered = value.lower()
    if "placeholder" in lowered or "changeme" in lowered:
        return True
    if len(value) < 80:
        return True
    if not (
        value.startswith("sk_live_")
        or value.startswith("sk_test_")
        or value.startswith("rk_live_")
        or value.startswith("rk_test_")
    ):
        return True
    return False


def is_placeholder_price(value: str | None) -> bool:
    if not value:
        return True
    if value.startswith("price_local"):
        return True
    if not value.startswith("price_"):
        return True
    if len(value) < 20:
        return True
    return False


def find_unsuffixed_stripe_keys(keys: Iterable[str]) -> list[str]:
    return sorted({k for k in keys if PLAIN_STRIPE_KEY_RE.match(k)})


def parse_kv_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text().splitlines():
        if "=" not in line or line.lstrip().startswith("#"):
            continue
        key, _, value = line.partition("=")
        out[key.strip()] = value.strip()
    return out


def assert_railway_stripe_ok(
    *,
    env_keys: Iterable[str],
    secret: str | None,
    price: str | None,
) -> None:
    """Raise ValueError when Railway Stripe wiring is unsafe to sync."""
    plain = find_unsuffixed_stripe_keys(env_keys)
    if plain:
        raise ValueError(
            "Railway has unsuffixed Stripe vars (use STRIPE_*_NITROGEN only): "
            + ", ".join(plain)
        )
    if is_placeholder_stripe_secret(secret):
        raise ValueError("STRIPE_SECRET_KEY_NITROGEN missing/placeholder")
    if is_placeholder_price(price):
        raise ValueError("STRIPE_PRICE_ID_NITROGEN missing/placeholder")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check-kv",
        type=Path,
        help="Railway `variables --kv` dump to validate (exit 1 on failure)",
    )
    args = parser.parse_args(argv)
    if not args.check_kv:
        parser.error("pass --check-kv PATH")
    env = parse_kv_file(args.check_kv)
    try:
        assert_railway_stripe_ok(
            env_keys=env.keys(),
            secret=env.get("STRIPE_SECRET_KEY_NITROGEN"),
            price=env.get("STRIPE_PRICE_ID_NITROGEN"),
        )
    except ValueError as exc:
        print(f"❌ {exc}", file=sys.stderr)
        return 1
    print("✓ Railway STRIPE_*_NITROGEN secret + price look live")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
