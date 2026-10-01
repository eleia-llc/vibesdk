#!/usr/bin/env python3
"""Mint a GitHub App installation token for this repository.

Reads UPSTREAM_SYNC_APP_ID and UPSTREAM_SYNC_APP_PRIVATE_KEY. Prints only the
installation token. The App must be installed on this repo with Contents,
Pull requests, and Workflows set to read and write.
"""

import base64
import json
import os
import subprocess
import tempfile
import time
import urllib.request


def b64(data: bytes) -> bytes:
    return base64.urlsafe_b64encode(data).rstrip(b"=")


def main() -> None:
    app_id = os.environ["UPSTREAM_SYNC_APP_ID"].strip()
    key = os.environ["UPSTREAM_SYNC_APP_PRIVATE_KEY"]
    if "\\n" in key:
        key = key.replace("\\n", "\n")
    now = int(time.time())
    header = b64(json.dumps({"alg": "RS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = b64(
        json.dumps({"iat": now - 60, "exp": now + 540, "iss": app_id}, separators=(",", ":")).encode()
    )
    signing = header + b"." + payload
    with tempfile.NamedTemporaryFile("w", delete=False) as handle:
        handle.write(key if key.endswith("\n") else key + "\n")
        key_path = handle.name
    try:
        signature = subprocess.check_output(
            ["openssl", "dgst", "-sha256", "-sign", key_path],
            input=signing,
        )
    finally:
        os.unlink(key_path)
    jwt = (signing + b"." + b64(signature)).decode()
    repo = os.environ["GITHUB_REPOSITORY"]
    headers = {
        "Authorization": f"Bearer {jwt}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "eleia-upstream-sync",
    }
    install_req = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/installation",
        headers=headers,
    )
    with urllib.request.urlopen(install_req) as response:
        installation_id = json.load(response)["id"]
    token_req = urllib.request.Request(
        f"https://api.github.com/app/installations/{installation_id}/access_tokens",
        data=b"{}",
        method="POST",
        headers=headers,
    )
    with urllib.request.urlopen(token_req) as response:
        print(json.load(response)["token"], end="")


if __name__ == "__main__":
    main()
