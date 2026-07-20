"""Unit tests for scripts/stripe_secret_guards.py (P0 Stripe wiring)."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = ROOT / "scripts" / "stripe_secret_guards.py"


def _load():
    spec = importlib.util.spec_from_file_location("stripe_secret_guards", MODULE_PATH)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


guards = _load()


def _live_secret() -> str:
    return "sk_live_" + ("x" * 90)


def _live_price() -> str:
    return "price_" + ("y" * 20)


def test_placeholder_secret_rejected():
    assert guards.is_placeholder_stripe_secret("sk_test_local")
    assert guards.is_placeholder_stripe_secret("sk_live_short")
    assert guards.is_placeholder_stripe_secret(None)
    assert not guards.is_placeholder_stripe_secret(_live_secret())


def test_placeholder_price_rejected():
    assert guards.is_placeholder_price("price_local_individual")
    assert guards.is_placeholder_price("not-a-price")
    assert not guards.is_placeholder_price(_live_price())


def test_unsuffixed_stripe_keys_detected():
    keys = [
        "STRIPE_SECRET_KEY",
        "STRIPE_SECRET_KEY_NITROGEN",
        "STRIPE_PRICE_ID",
        "OPENAI_API_KEY",
    ]
    assert guards.find_unsuffixed_stripe_keys(keys) == [
        "STRIPE_PRICE_ID",
        "STRIPE_SECRET_KEY",
    ]


def test_assert_railway_stripe_ok_passes_for_nitrogen_live_keys():
    guards.assert_railway_stripe_ok(
        env_keys=["STRIPE_SECRET_KEY_NITROGEN", "STRIPE_PRICE_ID_NITROGEN"],
        secret=_live_secret(),
        price=_live_price(),
    )


def test_assert_railway_stripe_ok_rejects_plain_stripe_keys():
    with pytest.raises(ValueError, match="unsuffixed"):
        guards.assert_railway_stripe_ok(
            env_keys=["STRIPE_SECRET_KEY", "STRIPE_SECRET_KEY_NITROGEN"],
            secret=_live_secret(),
            price=_live_price(),
        )


def test_check_kv_cli(tmp_path: Path):
    kv = tmp_path / "railway.kv"
    kv.write_text(
        "\n".join(
            [
                f"STRIPE_SECRET_KEY_NITROGEN={_live_secret()}",
                f"STRIPE_PRICE_ID_NITROGEN={_live_price()}",
            ]
        )
        + "\n"
    )
    assert guards.main(["--check-kv", str(kv)]) == 0

    bad = tmp_path / "bad.kv"
    bad.write_text("STRIPE_SECRET_KEY=sk_test_local\nSTRIPE_PRICE_ID=price_local\n")
    assert guards.main(["--check-kv", str(bad)]) == 1
