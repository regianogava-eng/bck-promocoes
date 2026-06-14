# -*- coding: utf-8 -*-
"""Registra um numero do WhatsApp Cloud API usando o PIN recebido.

Uso recomendado no PowerShell, sem salvar token/PIN em arquivo:

    $env:WHATSAPP_ACCESS_TOKEN="cole_o_token_da_meta_aqui"
    $env:WHATSAPP_WABA_ID="2235684346968129"
    $env:WHATSAPP_REGISTER_PIN="cole_o_pin_de_6_digitos_aqui"
    py tools\register_whatsapp_phone.py
    Remove-Item Env:\WHATSAPP_ACCESS_TOKEN
    Remove-Item Env:\WHATSAPP_WABA_ID
    Remove-Item Env:\WHATSAPP_REGISTER_PIN
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

DEFAULT_WABA_ID = "2235684346968129"
DEFAULT_PHONE_DIGITS = "5528999849520"


def only_digits(value: str) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def mask(value: str, keep: int = 4) -> str:
    value = str(value or "")
    if len(value) <= keep:
        return "*" * len(value)
    return "*" * (len(value) - keep) + value[-keep:]


ACCESS_TOKEN = env("WHATSAPP_ACCESS_TOKEN") or env("META_ACCESS_TOKEN")
APP_SECRET = env("META_APP_SECRET")
API_VERSION = env("WHATSAPP_API_VERSION", "v25.0")
WABA_ID = env("WHATSAPP_WABA_ID") or env("WABA_ID", DEFAULT_WABA_ID)
PHONE_NUMBER_ID = env("WHATSAPP_PHONE_NUMBER_ID")
TARGET_PHONE = only_digits(env("WHATSAPP_TARGET_PHONE", DEFAULT_PHONE_DIGITS))
PIN = only_digits(env("WHATSAPP_REGISTER_PIN"))


def graph_request(method: str, path: str, params: dict[str, Any] | None = None, body: dict[str, Any] | None = None) -> tuple[bool, Any]:
    query = dict(params or {})
    query["access_token"] = ACCESS_TOKEN
    if APP_SECRET:
        query["appsecret_proof"] = hmac.new(APP_SECRET.encode("utf-8"), ACCESS_TOKEN.encode("utf-8"), hashlib.sha256).hexdigest()

    url = f"https://graph.facebook.com/{API_VERSION}/{path.lstrip('/')}"
    if query:
        url = f"{url}?{urllib.parse.urlencode(query)}"

    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=data, headers=headers, method=method.upper())
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return True, json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        try:
            return False, json.loads(exc.read().decode("utf-8") or "{}")
        except Exception:
            return False, {"error": str(exc)}
    except Exception as exc:
        return False, {"error": str(exc)}


def phone_matches_target(display_phone_number: str) -> bool:
    display = only_digits(display_phone_number)
    return display == TARGET_PHONE or display.endswith(TARGET_PHONE[-10:])


def find_phone_number_id() -> str:
    if PHONE_NUMBER_ID:
        ok, payload = graph_request("GET", PHONE_NUMBER_ID, {"fields": "id,display_phone_number,verified_name,code_verification_status,quality_rating,platform_type"})
        if ok and phone_matches_target(payload.get("display_phone_number", "")):
            print("Phone Number ID configurado confere com o numero alvo:")
            print(json.dumps(payload, indent=2, ensure_ascii=False))
            return PHONE_NUMBER_ID
        if ok:
            raise RuntimeError("WHATSAPP_PHONE_NUMBER_ID configurado e de outro numero. Nao vou registrar para evitar usar telefone errado.")
        print("Nao consegui validar WHATSAPP_PHONE_NUMBER_ID. Vou procurar na WABA.")

    ok, payload = graph_request("GET", f"{WABA_ID}/phone_numbers", {"fields": "id,display_phone_number,verified_name,code_verification_status", "limit": 100})
    if not ok:
        raise RuntimeError("Nao consegui listar telefones da WABA: " + json.dumps(payload, ensure_ascii=False))

    for item in payload.get("data", []):
        if phone_matches_target(item.get("display_phone_number", "")):
            print("Telefone alvo encontrado:")
            print(json.dumps(item, indent=2, ensure_ascii=False))
            return str(item.get("id") or "")

    raise RuntimeError("Nao encontrei o numero alvo na WABA. Confira WHATSAPP_WABA_ID ou WHATSAPP_TARGET_PHONE.")


def main() -> int:
    print("Registro de telefone WhatsApp Cloud API - BCK")
    print(f"API: {API_VERSION}")
    print(f"WABA ID: {WABA_ID}")
    print(f"Numero alvo: {mask(TARGET_PHONE)}")
    print(f"Token carregado: {'sim ' + mask(ACCESS_TOKEN) if ACCESS_TOKEN else 'nao'}")
    print(f"PIN carregado: {'sim ' + mask(PIN, 2) if PIN else 'nao'}")

    if not ACCESS_TOKEN:
        print("\nFalta WHATSAPP_ACCESS_TOKEN/META_ACCESS_TOKEN.")
        return 2
    if len(PIN) != 6:
        print("\nFalta WHATSAPP_REGISTER_PIN com 6 digitos.")
        return 2

    phone_id = find_phone_number_id()
    print(f"\nRegistrando Phone Number ID {phone_id}...")
    ok, payload = graph_request("POST", f"{phone_id}/register", body={"messaging_product": "whatsapp", "pin": PIN})
    print("OK" if ok else "FALHOU")
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
