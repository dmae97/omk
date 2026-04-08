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
    todo_phases = []

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
                            "todoPhases": todo_phases,
                        },
                    }
                ),
                flush=True,
            )
        elif command_type == "set_todos":
            todo_phases = command.get("phases", [])
            print(
                json.dumps(
                    {
                        "id": request_id,
                        "type": "response",
                        "command": "set_todos",
                        "success": True,
                        "data": {
                            "todoPhases": todo_phases,
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
            print(json.dumps({"type": "turn_start"}), flush=True)
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
            print(json.dumps({"type": "turn_end", "message": assistant, "toolResults": []}), flush=True)
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

    def test_command_builder_supports_common_rpc_options(self) -> None:
        client = RpcClient(
            executable="omp",
            model="openrouter/anthropic/claude-sonnet-4.6",
            cwd="/tmp/workspace",
            thinking="high",
            append_system_prompt="extra instructions",
            provider_session_id="provider-session-1",
            tools=("read", "edit", "write"),
            no_session=True,
            no_skills=True,
            no_rules=True,
            extra_args=("--foo", "bar"),
        )

        self.assertEqual(
            client.command,
            (
                "omp",
                "--mode",
                "rpc",
                "--model",
                "openrouter/anthropic/claude-sonnet-4.6",
                "--thinking",
                "high",
                "--append-system-prompt",
                "extra instructions",
                "--provider-session-id",
                "provider-session-1",
                "--tools",
                "read,edit,write",
                "--no-session",
                "--no-skills",
                "--no-rules",
                "--no-title",
                "--foo",
                "bar",
            ),
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

    def test_install_headless_ui_cancels_interactive_requests(self) -> None:
        seen_methods: list[str] = []

        with self.make_client() as client:
            client.install_headless_ui(on_request=lambda request: seen_methods.append(request.method))
            client.prompt_and_wait("needs ui", timeout=2.0)

        self.assertEqual(seen_methods, ["input"])

    def test_ready_and_typed_event_listeners(self) -> None:
        ready_types: list[str] = []
        event_types: list[str] = []
        notification_types: list[str] = []
        client = self.make_client()
        client.on_ready(lambda event: ready_types.append(event.type))
        client.on_notification(lambda notification: notification_types.append(notification.type))
        client.on_turn_start(lambda event: event_types.append(event.type))
        client.on_message_update(lambda event: event_types.append(event.type))
        client.on_agent_end(lambda event: event_types.append(event.type))

        try:
            client.start()
            client.prompt_and_wait("say hello", timeout=2.0)
        finally:
            client.stop()

        self.assertEqual(ready_types, ["ready"])
        self.assertEqual(event_types, ["turn_start", "message_update", "agent_end"])
        self.assertIn("ready", notification_types)
        self.assertIn("turn_start", notification_types)
        self.assertIn("agent_end", notification_types)

    def test_set_todos_supports_flat_items(self) -> None:
        with self.make_client() as client:
            phases = client.set_todos(["Map tools", "Exercise edits"])

            self.assertEqual(len(phases), 1)
            self.assertEqual(phases[0].name, "Todos")
            self.assertEqual(phases[0].tasks[0].content, "Map tools")
            self.assertEqual(phases[0].tasks[1].status, "pending")

            state = client.get_state()
            self.assertEqual(state.todo_phases[0].tasks[1].content, "Exercise edits")


if __name__ == "__main__":
    unittest.main()
