from agent.tools import COMMAND_PROMPTS, TOOL_DEFINITIONS, TOOL_HANDLERS


def test_command_prompts_reference_real_tools():
    for entry in COMMAND_PROMPTS:
        assert entry["tool"] in TOOL_HANDLERS, f"{entry['command']} references unknown tool {entry['tool']}"


def test_command_prompts_have_unique_commands():
    commands = [c["command"] for c in COMMAND_PROMPTS]
    assert len(commands) == len(set(commands))


def test_command_prompts_start_with_slash():
    assert all(c["command"].startswith("/") for c in COMMAND_PROMPTS)


# --- TOOL_DEFINITIONS / TOOL_HANDLERS pairing (CLAUDE.md invariant #1) -----
# Schema and handler must change together — a tool with a schema but no
# registered handler would fail at call time, not at import/lint time.

def test_every_tool_definition_has_a_registered_handler():
    for tool in TOOL_DEFINITIONS:
        assert tool["name"] in TOOL_HANDLERS, f"{tool['name']} has a schema but no TOOL_HANDLERS entry"


def test_save_income_and_get_income_are_registered():
    assert "save_income" in TOOL_HANDLERS
    assert "get_income" in TOOL_HANDLERS
    assert {t["name"] for t in TOOL_DEFINITIONS} >= {"save_income", "get_income"}
