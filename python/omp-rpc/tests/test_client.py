from __future__ import annotations

import sys
import textwrap
import unittest

from omp_rpc import RpcClient


FAKE_SERVER = textwrap.dedent(
    """
    import json
    import sys

    def usage():
        return {
            "input": 1,
            "output": 1,
            "cacheRead": 0,
            "cacheWrite": 0,
            "totalTokens": 2,
            "cost": {
                "input": 0.0,
                "output": 0.0,
                "cacheRead": 0.0,
                "cacheWrite": 0.0,
                "total": 0.0,
            },
        }

    def assistant_message(text: str):
        return {
            "role": "assistant",
            "content": [{"type": "text", "text": text}],
            "api": "anthropic-messages",
            "provider": "anthropic",
            "model": "claude-sonnet-4-5",
            "usage": usage(),
            "stopReason": "stop",
            "timestamp": 1,
        }

    print(json.dumps({"type": "ready"}), flush=True)

    for raw_line in sys.stdin:
        raw_line = raw_line.strip()
        if not raw_line:
            continue

        command = json.loads(raw_line)
        command_type = command["type"]
        request_id = command.get("id")

        if command_type == "extension_ui_response":
            print(json.dumps({"type": "agent_end", "messages": [assistant_message("ui acknowledged")]}), flush=True)
            continue

        if command_type == "get_state":
            print(
                json.dumps(
                    {
                        "id": request_id,
                        "type": "response",
                        "command": "get_state",
                        "success": True,
                        "data": {
                            "model": {
                                "id": "claude-sonnet-4-5",
                                "name": "Claude Sonnet 4.5",
                                "api": "anthropic-messages",
                                "provider": "anthropic",
                                "baseUrl": "https://api.anthropic.com",
                                "reasoning": True,
                                "input": ["text"],
                                "cost": {
                                    "input": 1.0,
                                    "output": 2.0,
                                    "cacheRead": 0.0,
                                    "cacheWrite": 0.0,
                                },
                                "contextWindow": 200000,
                                "maxTokens": 8192,
                            },
                            "thinkingLevel": "medium",
                            "isStreaming": False,
                            "isCompacting": False,
                            "steeringMode": "one-at-a-time",
                            "followUpMode": "one-at-a-time",
                            "interruptMode": "immediate",
                            "sessionId": "fake-session",
                            "autoCompactionEnabled": True,
                            "messageCount": 0,
                            "queuedMessageCount": 0,
                        },
                    }
                ),
                flush=True,
            )
        elif command_type == "bash":
            print(
                json.dumps(
                    {
                        "id": request_id,
                        "type": "response",
                        "command": "bash",
                        "success": True,
                        "data": {
                            "output": "hello\\n",
                            "exitCode": 0,
                            "cancelled": False,
                            "truncated": False,
                            "totalLines": 1,
                            "totalBytes": 6,
                            "outputLines": 1,
                            "outputBytes": 6,
                        },
                    }
                ),
                flush=True,
            )
        elif command_type == "prompt":
            print(
                json.dumps(
                    {
                        "id": request_id,
                        "type": "response",
                        "command": "prompt",
                        "success": True,
                    }
                ),
                flush=True,
            )
            if command["message"] == "needs ui":
                print(
                    json.dumps(
                        {
                            "type": "extension_ui_request",
                            "id": "ui-1",
                            "method": "input",
                            "title": "Need input",
                            "placeholder": "value",
                        }
                    ),
                    flush=True,
                )
                continue

            print(json.dumps({"type": "agent_start"}), flush=True)
            partial = assistant_message("")
            print(
                json.dumps(
                    {
                        "type": "message_update",
                        "message": partial,
                        "assistantMessageEvent": {
                            "type": "text_delta",
                            "contentIndex": 0,
                            "delta": "pong",
                            "partial": partial,
                        },
                    }
                ),
                flush=True,
            )
            assistant = assistant_message("pong")
            print(json.dumps({"type": "message_end", "message": assistant}), flush=True)
            print(json.dumps({"type": "agent_end", "messages": [assistant]}), flush=True)
        else:
            print(
                json.dumps(
                    {
                        "id": request_id,
                        "type": "response",
                        "command": command_type,
                        "success": False,
                        "error": f"unsupported: {command_type}",
                    }
                ),
                flush=True,
            )
    """
)


class RpcClientTests(unittest.TestCase):
    def make_client(self) -> RpcClient:
        return RpcClient(
            command=[sys.executable, "-u", "-c", FAKE_SERVER],
            startup_timeout=2.0,
            request_timeout=2.0,
        )

    def test_get_state_and_bash(self) -> None:
        with self.make_client() as client:
            state = client.get_state()
            self.assertEqual(state.session_id, "fake-session")
            self.assertEqual(state.model.id if state.model else None, "claude-sonnet-4-5")

            result = client.bash("echo hello")
            self.assertEqual(result.output, "hello\n")
            self.assertEqual(result.exit_code, 0)

    def test_prompt_and_wait_returns_assistant_text(self) -> None:
        with self.make_client() as client:
            turn = client.prompt_and_wait("say hello", timeout=2.0)
            self.assertEqual(turn.require_assistant_text(), "pong")
            self.assertGreaterEqual(len(turn.events), 3)

    def test_extension_ui_round_trip(self) -> None:
        with self.make_client() as client:
            client.prompt("needs ui")
            request = client.next_ui_request(timeout=2.0)
            self.assertEqual(request.method, "input")

            client.send_ui_value(request.id, "approved")
            client.wait_for_idle(timeout=2.0)


if __name__ == "__main__":
    unittest.main()
