"""One-time Gmail OAuth flow.

Run once to mint a refresh token and save it at GMAIL_TOKEN_PATH.
Requires the Desktop OAuth client JSON at GMAIL_CLIENT_SECRETS.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Allow running as `python scripts/gmail_oauth.py` from agent/
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from lookout_agent.config import get_settings  # noqa: E402
from lookout_agent.email.gmail import _load_credentials  # noqa: E402


def main() -> None:
    settings = get_settings()
    client = Path(settings.gmail_client_secrets)
    token = Path(settings.gmail_token_path)
    creds = _load_credentials(client, token)
    print(f"OK. Token saved to {token}.")
    print(f"Scopes: {creds.scopes}")
    print(f"Expires: {creds.expiry}")


if __name__ == "__main__":
    main()
