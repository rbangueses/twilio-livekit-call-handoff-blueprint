import importlib.util
from pathlib import Path
from unittest import mock
import unittest


ROOT_DIR = Path(__file__).resolve().parents[1]
MODULE_PATHS = (
    ROOT_DIR / "examples" / "livekit_flex_handoff_helpers.py",
    ROOT_DIR / "agent" / "livekit_flex_handoff_helpers.py",
)


def load_module(module_path):
    spec = importlib.util.spec_from_file_location(module_path.stem, module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class LiveKitFlexHandoffHelpersTest(unittest.TestCase):
    def test_builds_payload_from_mapped_sip_attributes(self):
        for module_path in MODULE_PATHS:
            with self.subTest(module_path=module_path):
                helpers = load_module(module_path)

                payload = helpers.build_escalation_payload(
                    {
                        "parentCallSid": "CAparent",
                        "handoffId": "handoff-123",
                        "sip.phoneNumber": "+14155550100",
                        "sip.twilio.callSid": "CAchild",
                    },
                    intent="account_access",
                    summary="Caller tried the reset code and still needs help.",
                )

                self.assertEqual(payload["parentCallSid"], "CAparent")
                self.assertEqual(payload["handoffId"], "handoff-123")
                self.assertEqual(payload["from"], "+14155550100")
                self.assertEqual(payload["intent"], "account_access")
                self.assertEqual(
                    payload["summary"],
                    "Caller tried the reset code and still needs help.",
                )

    def test_uses_raw_header_attribute_when_mapping_is_not_ready(self):
        for module_path in MODULE_PATHS:
            with self.subTest(module_path=module_path):
                helpers = load_module(module_path)

                payload = helpers.build_escalation_payload(
                    {
                        "sip.h.X-Parent-CallSid": "CAparent",
                        "sip.h.X-Handoff-Id": "handoff-raw",
                    },
                    intent="support",
                    summary="Caller asked for a person.",
                )

                self.assertEqual(payload["parentCallSid"], "CAparent")
                self.assertEqual(payload["handoffId"], "handoff-raw")

    def test_escalation_payload_includes_optional_memory_attributes(self):
        for module_path in MODULE_PATHS:
            with self.subTest(module_path=module_path):
                helpers = load_module(module_path)

                payload = helpers.build_escalation_payload(
                    {
                        "parentCallSid": "CAparent",
                        "customerPhone": "+14155550100",
                        "memoryStoreId": "mem_store_123",
                        "memoryProfileId": "mem_profile_123",
                    },
                    intent="account_access",
                    summary="Caller needs an agent with prior context.",
                )

                self.assertEqual(payload["customerPhone"], "+14155550100")
                self.assertEqual(payload["memoryStoreId"], "mem_store_123")
                self.assertEqual(payload["memoryProfileId"], "mem_profile_123")

    def test_rejects_child_sip_call_sid_without_parent_call_sid(self):
        for module_path in MODULE_PATHS:
            with self.subTest(module_path=module_path):
                helpers = load_module(module_path)

                with self.assertRaises(ValueError) as error:
                    helpers.build_escalation_payload(
                        {"sip.twilio.callSid": "CAchild"},
                        intent="support",
                        summary="Caller asked for a person.",
                    )

                self.assertIn("parentCallSid", str(error.exception))

    def test_builds_memory_recall_payload_from_mapped_sip_attributes(self):
        for module_path in MODULE_PATHS:
            with self.subTest(module_path=module_path):
                helpers = load_module(module_path)

                payload = helpers.build_memory_recall_payload(
                    {
                        "memoryStoreId": "mem_store_123",
                        "memoryProfileId": "mem_profile_123",
                        "customerPhone": "+14155550100",
                    },
                    query="account access history",
                )

                self.assertEqual(payload["memoryStoreId"], "mem_store_123")
                self.assertEqual(payload["memoryProfileId"], "mem_profile_123")
                self.assertEqual(payload["customerPhone"], "+14155550100")
                self.assertEqual(payload["query"], "account access history")

    def test_uses_raw_memory_header_attributes_when_mapping_is_not_ready(self):
        for module_path in MODULE_PATHS:
            with self.subTest(module_path=module_path):
                helpers = load_module(module_path)

                payload = helpers.build_memory_recall_payload(
                    {
                        "sip.h.X-Memory-Store-Id": "mem_store_raw",
                        "sip.h.X-Memory-Profile-Id": "mem_profile_raw",
                        "sip.h.X-Customer-Phone": "+14155550100",
                    },
                    query="",
                )

                self.assertEqual(payload["memoryStoreId"], "mem_store_raw")
                self.assertEqual(payload["memoryProfileId"], "mem_profile_raw")
                self.assertEqual(payload["customerPhone"], "+14155550100")
                self.assertNotIn("query", payload)

    def test_rejects_memory_recall_without_memory_profile(self):
        for module_path in MODULE_PATHS:
            with self.subTest(module_path=module_path):
                helpers = load_module(module_path)

                with self.assertRaises(ValueError) as error:
                    helpers.build_memory_recall_payload(
                        {"memoryStoreId": "mem_store_123"},
                        query="account access history",
                    )

                self.assertIn("memoryProfileId or customerPhone", str(error.exception))

    def test_builds_memory_recall_payload_with_customer_phone_when_profile_is_missing(self):
        for module_path in MODULE_PATHS:
            with self.subTest(module_path=module_path):
                helpers = load_module(module_path)

                payload = helpers.build_memory_recall_payload(
                    {
                        "memoryStoreId": "mem_store_123",
                        "customerPhone": "+14155550100",
                    },
                    query="account access history",
                )

                self.assertEqual(payload["memoryStoreId"], "mem_store_123")
                self.assertEqual(payload["customerPhone"], "+14155550100")
                self.assertNotIn("memoryProfileId", payload)

    def test_posts_escalation_to_custom_handoff_path(self):
        for module_path in MODULE_PATHS:
            with self.subTest(module_path=module_path):
                helpers = load_module(module_path)
                requests = []

                class FakeUrlopen:
                    def __enter__(self):
                        return self

                    def __exit__(self, exc_type, exc, tb):
                        return False

                    def read(self):
                        return b'{"ok": true}'

                def capture_request(request, timeout):
                    requests.append((request, timeout))
                    return FakeUrlopen()

                with mock.patch.object(
                    helpers.urllib.request,
                    "urlopen",
                    side_effect=capture_request,
                ):
                    result = helpers.post_flex_escalation(
                        "https://handoff.example.twil.io/",
                        "token-123",
                        {"parentCallSid": "CAparent"},
                        path="/studio_escalate",
                    )

                self.assertEqual(result, {"ok": True})
                self.assertEqual(
                    requests[0][0].full_url,
                    "https://handoff.example.twil.io/studio_escalate",
                )
                self.assertEqual(requests[0][1], 10)

    def test_posts_memory_recall_to_handoff_service(self):
        for module_path in MODULE_PATHS:
            with self.subTest(module_path=module_path):
                helpers = load_module(module_path)
                requests = []

                class FakeUrlopen:
                    def __enter__(self):
                        return self

                    def __exit__(self, exc_type, exc, tb):
                        return False

                    def read(self):
                        return b'{"text":"Caller prefers email updates."}'

                def capture_request(request, timeout):
                    requests.append((request, timeout))
                    return FakeUrlopen()

                with mock.patch.object(
                    helpers.urllib.request,
                    "urlopen",
                    side_effect=capture_request,
                ):
                    result = helpers.post_memory_recall(
                        "https://handoff.example.twil.io/",
                        "token-123",
                        {
                            "memoryStoreId": "mem_store_123",
                            "memoryProfileId": "mem_profile_123",
                            "query": "account history",
                        },
                    )

                self.assertEqual(result["text"], "Caller prefers email updates.")
                self.assertEqual(
                    requests[0][0].full_url,
                    "https://handoff.example.twil.io/memory_recall",
                )
                self.assertEqual(requests[0][1], 10)


if __name__ == "__main__":
    unittest.main()
