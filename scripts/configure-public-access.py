#!/usr/bin/env python3
"""Create a hostname-specific Cloudflare Access bypass for Dots Party.

The specific app takes precedence over the protected *.selfserved.ai app.
Set CLOUDFLARE_ACCOUNT_ID and optionally DOTS_PARTY_HOST. The API token is
read from CLOUDFLARE_API_TOKEN and is never printed.
"""

import json
import os
import sys
import urllib.error
import urllib.request

ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
HOST = os.environ.get("DOTS_PARTY_HOST", "mm-game.selfserved.ai").strip()
BASE = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/access"


def load_token():
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
    if not token:
        raise SystemExit("Set CLOUDFLARE_API_TOKEN before running this script.")
    return token


def call(token, method, path, body=None):
    request = urllib.request.Request(
        BASE + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        return {"http_error": error.code, "body": error.read().decode()[:600]}


def main():
    if not ACCOUNT_ID:
        raise SystemExit("Set CLOUDFLARE_ACCOUNT_ID before running this script.")
    mode = sys.argv[1] if len(sys.argv) > 1 else "inspect"
    token = load_token()
    apps = call(token, "GET", "/apps")
    existing = next(
        (app for app in apps.get("result", []) if app.get("domain") == HOST), None
    )
    policies = call(token, "GET", f"/apps/{existing['id']}/policies") if existing else {"result": []}
    bypass = next(
        (policy for policy in policies.get("result", []) if policy.get("decision") == "bypass"),
        None,
    )
    if mode == "inspect":
        print(json.dumps({
            "host": HOST,
            "exists": bool(existing),
            "id": existing and existing["id"],
            "public_bypass": bool(bypass),
            "policy_id": bypass and bypass["id"],
        }))
        return
    if mode != "apply":
        raise SystemExit("Usage: configure-public-access.py [inspect|apply]")
    if existing:
        if bypass:
            print(json.dumps({"host": HOST, "status": "already configured", "id": existing["id"], "policy_id": bypass["id"]}))
            return
        result = call(token, "POST", f"/apps/{existing['id']}/policies", {
            "name": "Public game bypass (Everyone)",
            "decision": "bypass",
            "include": [{"everyone": {}}],
        })
        print(json.dumps({
            "host": HOST,
            "success": result.get("success", False),
            "id": existing["id"],
            "policy_id": result.get("result", {}).get("id"),
            "errors": result.get("errors", []),
        }))
        return
    result = call(token, "POST", "/apps", {
        "name": "Dots Party Public Game",
        "domain": HOST,
        "type": "self_hosted",
        "session_duration": "24h",
        "policies": [{
            "name": "Public game bypass (Everyone)",
            "decision": "bypass",
            "include": [{"everyone": {}}],
        }],
    })
    print(json.dumps({
        "host": HOST,
        "success": result.get("success", False),
        "id": result.get("result", {}).get("id"),
        "errors": result.get("errors", []),
        "http_error": result.get("http_error"),
    }))


if __name__ == "__main__":
    main()
