#!/usr/bin/env python3
"""Validate ONEBOX credentials, optionally probe the catalog API."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if (value.startswith('"') and value.endswith('"')) or (
            value.startswith("'") and value.endswith("'")
        ):
            value = value[1:-1]
        env[key.strip()] = value
    return env


def mask(secret: str) -> str:
    if len(secret) <= 8:
        return "***"
    return f"{secret[:4]}…{secret[-4:]}"


def http_request(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    data: bytes | None = None,
    timeout: int = 15,
) -> tuple[int, str]:
    request = urllib.request.Request(
        url, data=data, method=method, headers=headers or {}
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode("utf-8", errors="replace")


def parse_json(body: str):
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return None


def request_token(
    endpoint: str, client_id: str, client_secret: str, channel_id: str
) -> dict | None:
    payload = urllib.parse.urlencode(
        {
            "grant_type": "client_credentials",
            "channel_id": channel_id,
            "client_id": client_id,
            "client_secret": client_secret,
        }
    ).encode("utf-8")

    print(f"POST {endpoint}")
    print(f"  client_id:     {client_id}")
    print(f"  channel_id:    {channel_id}")
    print(f"  client_secret: {mask(client_secret)}")
    print()

    try:
        status, body = http_request(
            endpoint,
            method="POST",
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            },
            data=payload,
        )
    except urllib.error.URLError as err:
        print(f"Network error: {err.reason}", file=sys.stderr)
        return None

    parsed = parse_json(body)
    pretty = json.dumps(parsed, indent=2, ensure_ascii=False) if parsed else body
    print(f"Status: {status}")
    print("Response:")
    print(pretty)
    print()

    if status == 200 and isinstance(parsed, dict) and parsed.get("access_token"):
        print("Credentials are VALID — received an access_token.")
        return parsed
    if status in (400, 401, 403):
        print("Credentials appear INVALID (auth/grant rejected).")
        return None
    print("Unexpected response — inspect the body above to see what ONEBOX expects.")
    return None


def probe_sessions(base_url: str, token: str) -> int:
    sessions_url = urllib.parse.urljoin(base_url, "/catalog-api/v1/sessions")
    print()
    print("─" * 60)
    print(f"GET {sessions_url}")
    print()

    try:
        status, body = http_request(
            sessions_url,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
            },
        )
    except urllib.error.URLError as err:
        print(f"Network error: {err.reason}", file=sys.stderr)
        return 2

    print(f"Status: {status}")
    parsed = parse_json(body)

    if status != 200:
        print("Response:")
        print(json.dumps(parsed, indent=2, ensure_ascii=False) if parsed else body)
        print()
        print("Sessions probe FAILED.")
        return 1

    sessions = parsed
    if isinstance(parsed, dict):
        for key in ("sessions", "data", "items", "content", "results"):
            if isinstance(parsed.get(key), list):
                sessions = parsed[key]
                break

    if isinstance(sessions, list):
        print(f"Sessions returned: {len(sessions)}")
        if sessions:
            print()
            print("First session:")
            print(json.dumps(sessions[0], indent=2, ensure_ascii=False))
        else:
            print("(empty list)")
    else:
        print("Response (unexpected shape):")
        print(json.dumps(parsed, indent=2, ensure_ascii=False) if parsed else body)
        return 1

    print()
    print("Sessions probe OK — token works against the catalog API.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--probe",
        action="store_true",
        help="After auth, GET /catalog-api/v1/sessions and show the first session.",
    )
    args = parser.parse_args()

    env = load_env(Path(__file__).parent / ".env")
    client_id = env.get("ONEBOX_CLIENT_ID")
    client_secret = env.get("ONEBOX_CLIENT_SECRET")
    channel_id = env.get("ONEBOX_CHANNEL_ID")
    endpoint = env.get("ONEBOX_API_ENDPOINT")

    missing = [
        name
        for name, val in (
            ("ONEBOX_CLIENT_ID", client_id),
            ("ONEBOX_CLIENT_SECRET", client_secret),
            ("ONEBOX_CHANNEL_ID", channel_id),
            ("ONEBOX_API_ENDPOINT", endpoint),
        )
        if not val
    ]
    if missing:
        print(f"Missing in .env: {', '.join(missing)}", file=sys.stderr)
        return 1

    token_response = request_token(endpoint, client_id, client_secret, channel_id)
    if not token_response:
        return 1

    if not args.probe:
        return 0

    parsed_endpoint = urllib.parse.urlparse(endpoint)
    base_url = f"{parsed_endpoint.scheme}://{parsed_endpoint.netloc}"
    return probe_sessions(base_url, token_response["access_token"])


if __name__ == "__main__":
    sys.exit(main())
