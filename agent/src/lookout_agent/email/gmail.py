"""Gmail implementation of EmailProvider.

V1 uses OAuth2 installed-app flow. A one-time browser consent generates a
refresh token stored at GMAIL_TOKEN_PATH. Subsequent runs refresh silently.
"""

from __future__ import annotations

import base64
import json
import logging
import os
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import parseaddr, parsedate_to_datetime
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from ..config import get_settings
from .provider import (
    Address,
    AttachmentRef,
    DraftRef,
    EmailProvider,
    NormalizedMessage,
    NormalizedThread,
)

log = logging.getLogger(__name__)

# Full-access scope for a dedicated booking inbox. Simplest to operate; if we
# ever narrow, use readonly + send + compose + modify together.
SCOPES = ["https://mail.google.com/"]


def _load_credentials_from_json(token_json: str) -> Credentials:
    """Load creds from a JSON string (env-var path, used in deployed envs)."""
    info = json.loads(token_json)
    creds = Credentials.from_authorized_user_info(info, SCOPES)
    if creds.valid:
        return creds
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        return creds
    raise RuntimeError(
        "GMAIL_TOKEN_JSON is invalid or has no usable refresh token. "
        "Re-run the OAuth flow locally and update the env var."
    )


def _load_credentials(client_secrets: Path, token_path: Path) -> Credentials:
    creds: Credentials | None = None
    if token_path.exists():
        creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)

    if creds and creds.valid:
        return creds

    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
        token_path.write_text(creds.to_json())
        return creds

    if not client_secrets.exists():
        raise FileNotFoundError(
            f"Gmail client secrets not found at {client_secrets}. "
            "Download from Google Cloud Console (Desktop OAuth client) and save there."
        )

    flow = InstalledAppFlow.from_client_secrets_file(str(client_secrets), SCOPES)
    # Some environments can't launch a browser automatically (headless shells,
    # remote terminals, etc.). Allow forcing a manual open flow (prints a URL).
    oauth_mode = (os.environ.get("GMAIL_OAUTH_MODE") or "").strip().lower()
    if oauth_mode in {"manual", "headless"}:
        creds = flow.run_local_server(port=0, open_browser=False)
    else:
        creds = flow.run_local_server(port=0)
    token_path.parent.mkdir(parents=True, exist_ok=True)
    token_path.write_text(creds.to_json())
    return creds


class GmailProvider(EmailProvider):
    provider_name = "gmail"

    def __init__(self) -> None:
        settings = get_settings()
        self.user_email = settings.gmail_user_email

        if settings.gmail_token_json:
            self._creds = _load_credentials_from_json(settings.gmail_token_json)
        else:
            base = Path.cwd()
            client = base / settings.gmail_client_secrets
            token = base / settings.gmail_token_path
            if not client.exists() and (base / "agent" / settings.gmail_client_secrets).exists():
                client = base / "agent" / settings.gmail_client_secrets
                token = base / "agent" / settings.gmail_token_path
            self._creds = _load_credentials(client, token)

        self._service = build("gmail", "v1", credentials=self._creds, cache_discovery=False)

    def mailbox_identity_email(self) -> str:
        profile = self._service.users().getProfile(userId="me").execute()
        return str(profile["emailAddress"])

    # ---- Ingestion ---------------------------------------------------------

    def list_new_messages(
        self, cursor: str | None
    ) -> tuple[list[NormalizedMessage], str]:
        if cursor is None:
            return self._bootstrap_recent()
        return self._incremental(cursor)

    def _bootstrap_recent(self) -> tuple[list[NormalizedMessage], str]:
        """First-ever call: grab last 7 days of mail to prime the pipeline."""
        svc = self._service.users()
        profile = svc.getProfile(userId="me").execute()
        history_id = str(profile["historyId"])

        ids: list[str] = []
        page_token: str | None = None
        while True:
            resp = svc.messages().list(
                userId="me", q="newer_than:7d", maxResults=100, pageToken=page_token
            ).execute()
            for m in resp.get("messages", []):
                ids.append(m["id"])
            page_token = resp.get("nextPageToken")
            if not page_token:
                break

        messages = [self._fetch_and_normalize(mid) for mid in ids]
        messages = [m for m in messages if m is not None]
        messages.sort(key=lambda m: m.sent_at)
        return messages, history_id

    def _incremental(self, cursor: str) -> tuple[list[NormalizedMessage], str]:
        svc = self._service.users()
        seen_ids: set[str] = set()
        latest_history = cursor

        page_token: str | None = None
        while True:
            try:
                resp = svc.history().list(
                    userId="me",
                    startHistoryId=cursor,
                    historyTypes=["messageAdded"],
                    pageToken=page_token,
                    maxResults=500,
                ).execute()
            except Exception as e:  # noqa: BLE001
                # historyId can be expired (>7 days). Re-bootstrap.
                log.warning("history.list failed (%s); re-bootstrapping", e)
                return self._bootstrap_recent()

            for h in resp.get("history", []):
                latest_history = h.get("id", latest_history)
                for ma in h.get("messagesAdded", []):
                    mid = ma.get("message", {}).get("id")
                    if mid:
                        seen_ids.add(mid)
            page_token = resp.get("nextPageToken")
            if not page_token:
                break

        if "historyId" in resp:
            latest_history = str(resp["historyId"])

        messages = [self._fetch_and_normalize(mid) for mid in seen_ids]
        messages = [m for m in messages if m is not None]
        messages.sort(key=lambda m: m.sent_at)
        return messages, str(latest_history)

    def get_thread(self, provider_thread_id: str) -> NormalizedThread:
        data = (
            self._service.users()
            .threads()
            .get(userId="me", id=provider_thread_id, format="full")
            .execute()
        )
        msgs = [self._normalize(m) for m in data.get("messages", [])]
        msgs = [m for m in msgs if m is not None]
        msgs.sort(key=lambda m: m.sent_at)
        subject = msgs[0].subject if msgs else ""
        return NormalizedThread(
            provider_thread_id=provider_thread_id, subject=subject, messages=msgs
        )

    # ---- Sending -----------------------------------------------------------

    def send_message(
        self,
        to: list[str],
        subject: str,
        body_text: str,
        reply_to_thread_id: str | None = None,
        cc: list[str] | None = None,
    ) -> NormalizedMessage:
        raw = self._build_raw(to=to, subject=subject, body_text=body_text, cc=cc)
        body = {"raw": raw}
        if reply_to_thread_id:
            body["threadId"] = reply_to_thread_id
        sent = (
            self._service.users().messages().send(userId="me", body=body).execute()
        )
        # Hydrate the full normalized message so the caller can persist it.
        normalized = self._fetch_and_normalize(sent["id"])
        if normalized is None:
            raise RuntimeError(f"Could not fetch just-sent message {sent['id']}")
        return normalized

    # ---- Drafts ------------------------------------------------------------

    def create_draft(
        self,
        body_text: str,
        reply_to_thread_id: str | None = None,
        to: list[str] | None = None,
        subject: str | None = None,
        cc: list[str] | None = None,
    ) -> DraftRef:
        # Drafts need at least one recipient in Gmail to be meaningful, but
        # technically a draft can be saved without To set. We always send at
        # least a plausible subject.
        raw = self._build_raw(
            to=to or [], subject=subject or "", body_text=body_text, cc=cc
        )
        message_body: dict = {"raw": raw}
        if reply_to_thread_id:
            message_body["threadId"] = reply_to_thread_id
        draft = (
            self._service.users()
            .drafts()
            .create(userId="me", body={"message": message_body})
            .execute()
        )
        return DraftRef(
            provider_draft_id=draft["id"],
            provider_thread_id=draft.get("message", {}).get("threadId"),
        )

    def update_draft(self, provider_draft_id: str, body_text: str) -> None:
        current = (
            self._service.users()
            .drafts()
            .get(userId="me", id=provider_draft_id, format="metadata")
            .execute()
        )
        msg = current.get("message", {})
        headers = {h["name"]: h["value"] for h in msg.get("payload", {}).get("headers", [])}
        raw = self._build_raw(
            to=_parse_address_list(headers.get("To", "")),
            cc=_parse_address_list(headers.get("Cc", "")) or None,
            subject=headers.get("Subject", ""),
            body_text=body_text,
        )
        body: dict = {"message": {"raw": raw}}
        if msg.get("threadId"):
            body["message"]["threadId"] = msg["threadId"]
        self._service.users().drafts().update(
            userId="me", id=provider_draft_id, body=body
        ).execute()

    def get_draft(self, provider_draft_id: str) -> str:
        data = (
            self._service.users()
            .drafts()
            .get(userId="me", id=provider_draft_id, format="full")
            .execute()
        )
        text, _ = _extract_bodies(data.get("message", {}).get("payload", {}))
        return text or ""

    def send_draft(self, provider_draft_id: str) -> NormalizedMessage:
        sent = (
            self._service.users()
            .drafts()
            .send(userId="me", body={"id": provider_draft_id})
            .execute()
        )
        normalized = self._fetch_and_normalize(sent["id"])
        if normalized is None:
            raise RuntimeError(f"Could not fetch sent draft {sent['id']}")
        return normalized

    def discard_draft(self, provider_draft_id: str) -> None:
        self._service.users().drafts().delete(
            userId="me", id=provider_draft_id
        ).execute()

    # ---- Attachments -------------------------------------------------------

    def download_attachment(
        self, provider_message_id: str, provider_attachment_id: str
    ) -> bytes:
        resp = (
            self._service.users()
            .messages()
            .attachments()
            .get(userId="me", messageId=provider_message_id, id=provider_attachment_id)
            .execute()
        )
        return base64.urlsafe_b64decode(resp["data"] + "==")

    # ---- Internal helpers --------------------------------------------------

    def _build_raw(
        self,
        to: list[str],
        subject: str,
        body_text: str,
        cc: list[str] | None = None,
    ) -> str:
        msg = EmailMessage()
        msg["From"] = self.user_email
        if to:
            msg["To"] = ", ".join(to)
        if cc:
            msg["Cc"] = ", ".join(cc)
        msg["Subject"] = subject
        msg.set_content(body_text)
        return base64.urlsafe_b64encode(msg.as_bytes()).decode("ascii")

    def _fetch_and_normalize(self, message_id: str) -> NormalizedMessage | None:
        try:
            data = (
                self._service.users()
                .messages()
                .get(userId="me", id=message_id, format="full")
                .execute()
            )
        except Exception as e:  # noqa: BLE001
            log.warning("Failed to fetch message %s: %s", message_id, e)
            return None
        return self._normalize(data)

    def _normalize(self, data: dict) -> NormalizedMessage | None:
        try:
            payload = data.get("payload", {})
            headers = {h["name"]: h["value"] for h in payload.get("headers", [])}
            labels = data.get("labelIds", [])
            direction = "outbound" if "SENT" in labels else "inbound"

            from_name, from_email = parseaddr(headers.get("From", ""))
            to_list = _parse_addresses(headers.get("To", ""))
            cc_list = _parse_addresses(headers.get("Cc", ""))

            text, html = _extract_bodies(payload)
            attachments = _extract_attachments(payload)

            # Prefer internalDate (reliable) over Date header.
            ts_ms = int(data.get("internalDate", "0"))
            if ts_ms:
                sent_at = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc)
            else:
                try:
                    sent_at = parsedate_to_datetime(headers.get("Date", ""))
                    if sent_at.tzinfo is None:
                        sent_at = sent_at.replace(tzinfo=timezone.utc)
                except Exception:  # noqa: BLE001
                    sent_at = datetime.now(timezone.utc)

            return NormalizedMessage(
                provider_message_id=data["id"],
                provider_thread_id=data.get("threadId", ""),
                from_address=Address(email=from_email, name=from_name or None),
                to_addresses=to_list,
                cc_addresses=cc_list,
                subject=headers.get("Subject", ""),
                body_text=text or "",
                body_html=html,
                snippet=data.get("snippet", ""),
                sent_at=sent_at,
                in_reply_to=headers.get("In-Reply-To"),
                internet_message_id=headers.get("Message-Id") or headers.get("Message-ID") or "",
                headers=headers,
                attachments=attachments,
                direction=direction,
            )
        except Exception as e:  # noqa: BLE001
            log.exception("Failed to normalize Gmail message: %s", e)
            return None


# ---- Module-level parsing helpers -----------------------------------------

def _parse_address_list(raw: str) -> list[str]:
    if not raw:
        return []
    return [email for _, email in (parseaddr(a) for a in raw.split(",")) if email]


def _parse_addresses(raw: str) -> list[Address]:
    if not raw:
        return []
    out: list[Address] = []
    for chunk in raw.split(","):
        name, email = parseaddr(chunk)
        if email:
            out.append(Address(email=email, name=name or None))
    return out


def _walk(part: dict):
    yield part
    for child in part.get("parts", []):
        yield from _walk(child)


def _extract_bodies(payload: dict) -> tuple[str | None, str | None]:
    text, html = None, None
    for part in _walk(payload):
        mime = part.get("mimeType", "")
        data = part.get("body", {}).get("data")
        if not data:
            continue
        try:
            decoded = base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            continue
        if mime == "text/plain" and text is None:
            text = decoded
        elif mime == "text/html" and html is None:
            html = decoded
    return text, html


def _extract_attachments(payload: dict) -> list[AttachmentRef]:
    out: list[AttachmentRef] = []
    for part in _walk(payload):
        filename = part.get("filename")
        body = part.get("body", {})
        att_id = body.get("attachmentId")
        if filename and att_id:
            out.append(
                AttachmentRef(
                    provider_attachment_id=att_id,
                    filename=filename,
                    content_type=part.get("mimeType", "application/octet-stream"),
                    size_bytes=int(body.get("size", 0) or 0),
                )
            )
    return out
