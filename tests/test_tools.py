from agent.tools import COMMAND_PROMPTS, TOOL_HANDLERS


def test_command_prompts_reference_real_tools():
    for entry in COMMAND_PROMPTS:
        assert entry["tool"] in TOOL_HANDLERS, f"{entry['command']} references unknown tool {entry['tool']}"


def test_command_prompts_have_unique_commands():
    commands = [c["command"] for c in COMMAND_PROMPTS]
    assert len(commands) == len(set(commands))


def test_command_prompts_start_with_slash():
    assert all(c["command"].startswith("/") for c in COMMAND_PROMPTS)
