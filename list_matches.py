#!/usr/bin/env python3
"""List matches available on the configured ONEBOX channel."""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


def load_env(path: Path) -> dict:
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


def http_request(url, *, method="GET", headers=None, data=None, timeout=15):
    request = urllib.request.Request(
        url, data=data, method=method, headers=headers or {}
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode("utf-8", errors="replace")


def get_token(env: dict) -> str:
    payload = urllib.parse.urlencode(
        {
            "grant_type": "client_credentials",
            "channel_id": env["ONEBOX_CHANNEL_ID"],
            "client_id": env["ONEBOX_CLIENT_ID"],
            "client_secret": env["ONEBOX_CLIENT_SECRET"],
        }
    ).encode("utf-8")
    status, body = http_request(
        env["ONEBOX_API_ENDPOINT"],
        method="POST",
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
        data=payload,
    )
    if status != 200:
        print(f"Auth failed (status {status}): {body}", file=sys.stderr)
        sys.exit(1)
    return json.loads(body)["access_token"]


def main() -> int:
    env = load_env(Path(__file__).parent / ".env")
    required = [
        "ONEBOX_CLIENT_ID",
        "ONEBOX_CLIENT_SECRET",
        "ONEBOX_CHANNEL_ID",
        "ONEBOX_API_ENDPOINT",
    ]
    missing = [k for k in required if not env.get(k)]
    if missing:
        print(f"Missing in .env: {', '.join(missing)}", file=sys.stderr)
        return 1

    token = get_token(env)

    parsed = urllib.parse.urlparse(env["ONEBOX_API_ENDPOINT"])
    base = f"{parsed.scheme}://{parsed.netloc}"
    sessions_url = urllib.parse.urljoin(base, "/catalog-api/v1/sessions")

    status, body = http_request(
        sessions_url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        },
    )
    if status != 200:
        print(f"Sessions request failed (status {status}): {body}", file=sys.stderr)
        return 1

    data = json.loads(body)
    sessions = data
    if isinstance(data, dict):
        for key in ("sessions", "data", "items", "content", "results"):
            if isinstance(data.get(key), list):
                sessions = data[key]
                break

    if not isinstance(sessions, list):
        print("Unexpected response shape:", file=sys.stderr)
        print(json.dumps(data, indent=2, ensure_ascii=False)[:500], file=sys.stderr)
        return 1

    print(f"Matches available: {len(sessions)}")
    if sessions:
        first = sessions[0]
        event = first.get("event") or {}
        name = event.get("name") or first.get("name") or "(unnamed)"
        print(f"First match: {name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
