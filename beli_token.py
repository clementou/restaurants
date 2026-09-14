#!/usr/bin/env python3
"""Obtain or refresh Beli tokens using the unofficial Beli Maps login flow."""

import argparse
import getpass
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener


BASE_URL = "https://backoffice-service-onboarding-t57o3dxfca-nn.a.run.app"
DEFAULT_OUTPUT = Path(__file__).resolve().parent / ".beli-tokens.json"


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request_tokens(endpoint, payload):
    request = Request(
        BASE_URL + endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Origin": "https://localhost",
            "Referer": "https://localhost/",
            "User-Agent": (
                "Mozilla/5.0 (Linux; Android 16; SM-S928U) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/149.0.7827.91 Mobile Safari/537.36"
            ),
        },
        method="POST",
    )
    try:
        with build_opener(NoRedirects()).open(request, timeout=30) as response:
            result = json.load(response)
    except HTTPError as error:
        # Do not print response bodies: they may contain account information.
        if error.code in (400, 401):
            message = "Credentials or refresh token rejected. Try logging in again."
        elif error.code == 429:
            message = "Beli rate-limited the request. Wait before retrying."
        else:
            message = "Beli rejected the request; its unofficial API may have changed."
        raise RuntimeError(f"HTTP {error.code}: {message}") from None
    except URLError:
        raise RuntimeError("Could not reach Beli. Check your connection and TLS setup.") from None
    except (ValueError, UnicodeError):
        raise RuntimeError("Beli returned an invalid JSON response.") from None
    if not isinstance(result, dict) or not isinstance(result.get("access"), str) or not result["access"]:
        raise RuntimeError("Beli's response did not contain an access token.")
    refresh = result.get("refresh", payload.get("refresh"))
    if not isinstance(refresh, str) or not refresh:
        raise RuntimeError("Beli's response did not contain a usable refresh token.")
    return {"access": result["access"], "refresh": refresh}


def save_tokens(path, tokens):
    # Create a private file and atomically replace the previous token file.
    fd, temporary = tempfile.mkstemp(prefix=".beli-token-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            json.dump(tokens, output, indent=2)
            output.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phone", help="Phone number with country code, e.g. +14155551234")
    parser.add_argument("--refresh", action="store_true", help="Refresh tokens from the output file")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Token JSON file (default: .beli-tokens.json beside this script)")
    args = parser.parse_args()
    if args.refresh and args.phone:
        parser.error("--phone cannot be combined with --refresh")
    path = args.output.expanduser().absolute()
    if not path.parent.is_dir():
        parser.error(f"Output directory does not exist: {path.parent}")
    try:
        if args.refresh:
            try:
                stored = json.loads(path.read_text(encoding="utf-8"))
            except (ValueError, UnicodeError):
                raise RuntimeError("Token file is invalid JSON. Log in again.") from None
            refresh = stored.get("refresh") if isinstance(stored, dict) else None
            if not isinstance(refresh, str) or not refresh:
                raise RuntimeError("Token file has no refresh token. Log in again.")
            tokens = request_tokens("/api/token/refresh/", {"refresh": refresh})
        else:
            # Refuse getpass's fallback to echoed stdin when no terminal is present.
            if not sys.stdin.isatty():
                raise RuntimeError("Run login in an interactive terminal so the password stays hidden.")
            phone = args.phone or input("Beli phone number (including +country code): ")
            phone = re.sub(r"[\s().-]", "", phone)
            if not re.fullmatch(r"\+[1-9][0-9]{6,14}", phone):
                raise RuntimeError("Use a phone number with country code, e.g. +14155551234.")
            password = getpass.getpass("Beli password: ")
            if not password:
                raise RuntimeError("Password cannot be empty.")
            tokens = request_tokens("/api/token/", {"phone_no": phone, "password": password})
        save_tokens(path, tokens)
        print(f"Saved access and refresh tokens to {path} (owner-only permissions).")
        print("Your password was not saved.")
        return 0
    except (RuntimeError, OSError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    except (KeyboardInterrupt, EOFError):
        print("\nCancelled.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
