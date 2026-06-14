# -*- coding: utf-8 -*-
"""Diagnostico seguro de WhatsApp Cloud API para a BCK."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

DEFAULT_BUSINESS_ID = "320677210600761"
DEFAULT_WABA_ID = "2235684346968129"
DEFAULT_APP_ID = "1462881785038522"
DEFAULT_PHONE_DIGITS = "5528999849520"


def only_digits(value: str) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


ACCESS_TOKEN = env("WHATSAPP_ACCESS_TOKEN") or env("META_ACCESS_TOKEN")
APP_SECRET = env("META_APP_SECRET")
API_VERSION = env("WHATSAPP_API_VERSION", "v25.0")
BUSINESS_ID = env("META_BUSINESS_ID", DEFAULT_BUSINESS_ID)
WABA_ID = env("WHATSAPP_WABA_ID") or env("WABA_ID", DEFAULT_WABA_ID)
APP_ID = env("META_APP_ID", DEFAULT_APP_ID)
PHONE_NUMBER_ID = env("WHATSAPP_PHONE_NUMBER_ID")
TARGET_PHONE = only_digits(env("WHATSAPP_TARGET_PHONE", DEFAULT_PHONE_DIGITS))


def mask(value: str, keep: int = 4) -> str:
    value = str(value or "")
    if len(value) <= keep:
        return "*" * len(value)
    return "*" * (len(value) - keep) + value[-keep:]


def graph_get(path: str, params: dict[str, Any] | None = None) -> tuple[bool, Any]:
    if not ACCESS_TOKEN:
        return False, {"error": "WHATSAPP_ACCESS_TOKEN/META_ACCESS_TOKEN nao definido"}

    query = dict(params or {})
    query["access_token"] = ACCESS_TOKEN
    if APP_SECRET:
        query["appsecret_proof"] = hmac.new(
            APP_SECRET.encode("utf-8"),
            ACCESS_TOKEN.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    url = f"https://graph.facebook.com/{API_VERSION}/{path.lstrip('/')}"
    req = urllib.request.Request(f"{url}?{urllib.parse.urlencode(query)}", headers={"Accept": "application/json"})

    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            return True, json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        try:
            return False, json.loads(exc.read().decode("utf-8") or "{}")
        except Exception:
            return False, {"error": str(exc)}
    except Exception as exc:
        return False, {"error": str(exc)}


def print_result(title: str, ok: bool, payload: Any) -> None:
    print(f"\n=== {title} ===")
    print("OK" if ok else "FALHOU")
    print(json.dumps(payload, indent=2, ensure_ascii=False))


def phone_matches_target(display_phone_number: str) -> bool:
    display = only_digits(display_phone_number)
    return display == TARGET_PHONE or display.endswith(TARGET_PHONE[-10:])


def main() -> int:
    print("Diagnostico WhatsApp Cloud API - BCK")
    print(f"API: {API_VERSION}")
    print(f"Business ID: {BUSINESS_ID}")
    print(f"WABA ID: {WABA_ID}")
    print(f"App ID: {APP_ID}")
    print(f"Numero alvo: {mask(TARGET_PHONE)}")
    print(f"Token carregado: {'sim ' + mask(ACCESS_TOKEN) if ACCESS_TOKEN else 'nao'}")
    print(f"App secret carregado: {'sim' if APP_SECRET else 'nao'}")

    if not ACCESS_TOKEN:
        print("\nDefina WHATSAPP_ACCESS_TOKEN antes de rodar.")
        return 2

    checks: list[tuple[str, str, dict[str, Any]]] = [
        ("Token / usuario", "me", {"fields": "id,name"}),
        ("Permissoes do token", "me/permissions", {}),
        ("Aplicativo Meta", APP_ID, {"fields": "id,name"}),
        ("Portfolio de negocio", BUSINESS_ID, {"fields": "id,name,verification_status"}),
        ("WABA", WABA_ID, {"fields": "id,name,currency,timezone_id"}),
    ]

    for title, path, params in checks:
        ok, payload = graph_get(path, params)
        print_result(title, ok, payload)

    ok, phones_payload = graph_get(
        f"{WABA_ID}/phone_numbers",
        {
            "fields": "id,display_phone_number,verified_name,code_verification_status,quality_rating,platform_type,throughput",
            "limit": 100,
        },
    )
    print_result("Telefones dentro da WABA", ok, phones_payload)

    matching_phone_id = ""
    if PHONE_NUMBER_ID:
        phone_ok, phone_payload = graph_get(
            PHONE_NUMBER_ID,
            {"fields": "id,display_phone_number,verified_name,code_verification_status,quality_rating,platform_type,throughput"},
        )
        print_result("Phone Number ID informado no ambiente", phone_ok, phone_payload)
        if phone_ok and phone_matches_target(phone_payload.get("display_phone_number", "")):
            matching_phone_id = PHONE_NUMBER_ID
        elif phone_ok:
            print("\nATENCAO: WHATSAPP_PHONE_NUMBER_ID informado NAO parece ser do numero alvo.")

    if ok:
        for item in phones_payload.get("data", []):
            if phone_matches_target(item.get("display_phone_number", "")):
                matching_phone_id = str(item.get("id") or matching_phone_id)
                print(f"\nTelefone alvo encontrado na WABA: Phone Number ID {matching_phone_id}")
                break

    if not matching_phone_id:
        print("\nPhone Number ID nao encontrado. Configure WHATSAPP_PHONE_NUMBER_ID ou confira a lista acima.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
