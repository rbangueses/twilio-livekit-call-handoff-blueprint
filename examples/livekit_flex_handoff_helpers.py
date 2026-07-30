from __future__ import annotations

from collections.abc import Mapping
import json
import urllib.error
import urllib.request


DEFAULT_SUMMARY = "The LiveKit agent requested a human handoff."


def build_escalation_payload(
    attributes: Mapping[str, str],
    *,
    intent: str,
    summary: str,
) -> dict[str, str]:
    parent_call_sid = first_present(
        attributes,
        ("parentCallSid", "sip.h.X-Parent-CallSid"),
    )
    if not parent_call_sid:
        raise ValueError("Missing parentCallSid from LiveKit SIP participant attributes.")

    payload = {
        "parentCallSid": parent_call_sid,
        "intent": intent.strip() or "support",
        "summary": summary.strip() or DEFAULT_SUMMARY,
    }

    optional_values = {
        "handoffId": first_present(attributes, ("handoffId", "sip.h.X-Handoff-Id")),
        "from": first_present(attributes, ("sip.phoneNumber",)),
    }
    payload.update({key: value for key, value in optional_values.items() if value})
    return payload


def first_present(attributes: Mapping[str, str], names: tuple[str, ...]) -> str | None:
    for name in names:
        value = attributes.get(name)
        if value:
            return value
    return None


def post_flex_escalation(
    handoff_service_url: str,
    handoff_token: str,
    payload: Mapping[str, str],
    *,
    path: str = "/escalate",
) -> dict:
    endpoint = f"{handoff_service_url.rstrip('/')}/{path.lstrip('/')}"
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {handoff_token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            body = response.read().decode("utf-8")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8")
        raise RuntimeError(f"Flex escalation failed: HTTP {error.code} {body}") from error
