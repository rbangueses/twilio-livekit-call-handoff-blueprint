from pathlib import Path
import unittest


EXAMPLES_DIR = Path(__file__).resolve().parent
ROOT_DIR = EXAMPLES_DIR.parent


class LiveKitAgentExamplesTest(unittest.TestCase):
    def test_baseline_python_example_does_not_include_memory_tool(self):
        source = (EXAMPLES_DIR / "livekit_agent_tool.py").read_text()

        self.assertIn("transfer_to_flex", source)
        self.assertNotIn("recall_customer_memory", source)
        self.assertNotIn("post_memory_recall", source)
        self.assertNotIn("Memory rule:", source)

    def test_memory_python_example_includes_memory_tool(self):
        source = (EXAMPLES_DIR / "livekit_agent_tool_memory.py").read_text()

        self.assertIn("transfer_to_flex", source)
        self.assertIn("recall_customer_memory", source)
        self.assertIn("post_memory_recall", source)
        self.assertIn("Memory rule:", source)

    def test_memory_prompts_handle_explicit_prior_context_requests(self):
        paths = (
            EXAMPLES_DIR / "livekit_agent_tool_memory.py",
            ROOT_DIR / "agent" / "agent.py",
        )

        for path in paths:
            with self.subTest(path=path):
                source = path.read_text()

                self.assertIn("what happened previously", source)
                self.assertIn("summarize the relevant prior context", source)


if __name__ == "__main__":
    unittest.main()
