import importlib.util
from pathlib import Path
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


if __name__ == "__main__":
    unittest.main()
