import types

from agent import main


def make_block(type_, **kwargs):
    return types.SimpleNamespace(type=type_, **kwargs)


def make_response(content, stop_reason):
    return types.SimpleNamespace(content=content, stop_reason=stop_reason)


# --- _ocr_image / _build_user_content -------------------------------------

def test_ocr_image_returns_extracted_text(monkeypatch):
    response = make_response([types.SimpleNamespace(text="Total: $5.00")], "end_turn")
    monkeypatch.setattr(main.client.messages, "create", lambda **kw: response)

    assert main._ocr_image("base64data", "image/png") == "Total: $5.00"


def test_build_user_content_without_images_returns_input_unchanged():
    assert main._build_user_content("just text", None) == "just text"
    assert main._build_user_content("just text", []) == "just text"


def test_build_user_content_single_image_has_no_index_label(monkeypatch):
    monkeypatch.setattr(main, "_ocr_image", lambda data, media_type: "Receipt text")

    result = main._build_user_content("logged this", [{"data": "x", "media_type": "image/png"}])

    assert result == "logged this\n\n[Extracted text from image:]\nReceipt text"


def test_build_user_content_multiple_images_are_labeled_and_capped(monkeypatch):
    monkeypatch.setattr(main, "_ocr_image", lambda data, media_type: f"text-{data}")
    images = [{"data": str(i), "media_type": "image/png"} for i in range(main.MAX_IMAGES + 2)]

    result = main._build_user_content("multiple receipts", images)

    assert "[Extracted text from image 1 of 6:]\ntext-0" in result
    assert f"[Extracted text from image {main.MAX_IMAGES} of {main.MAX_IMAGES}:]\ntext-{main.MAX_IMAGES - 1}" in result
    assert f"text-{main.MAX_IMAGES}" not in result  # beyond the cap, dropped


# --- _run_tools ----------------------------------------------------------

def test_run_tools_dispatches_to_handler(monkeypatch):
    calls = []
    monkeypatch.setitem(
        main.TOOL_HANDLERS, "get_expenses",
        lambda **kw: calls.append(kw) or {"result": "ok"},
    )
    block = make_block("tool_use", name="get_expenses", input={"category": "Dining"}, id="tool_1")

    results = main._run_tools([block], user_id=42)

    assert calls == [{"category": "Dining"}]
    assert results == [{
        "type": "tool_result",
        "tool_use_id": "tool_1",
        "content": str({"result": "ok"}),
    }]


def test_run_tools_injects_user_id_for_save_expense(monkeypatch):
    captured = {}

    def fake_save_expense(**kw):
        captured.update(kw)
        return {"id": 1}

    monkeypatch.setitem(main.TOOL_HANDLERS, "save_expense", fake_save_expense)
    block = make_block("tool_use", name="save_expense", input={"amount": 5}, id="tool_2")

    main._run_tools([block], user_id=42)

    assert captured == {"amount": 5, "user_id": 42}


def test_run_tools_does_not_inject_user_id_for_other_tools(monkeypatch):
    captured = {}

    def fake_get_expenses(**kw):
        captured.update(kw)
        return []

    monkeypatch.setitem(main.TOOL_HANDLERS, "get_expenses", fake_get_expenses)
    block = make_block("tool_use", name="get_expenses", input={}, id="tool_3")

    main._run_tools([block], user_id=42)

    assert "user_id" not in captured


def test_run_tools_ignores_non_tool_use_blocks():
    block = make_block("text", text="hello")
    assert main._run_tools([block], user_id=1) == []


# --- clear_session ---------------------------------------------------------

def test_clear_session_removes_history():
    main._sessions["7"] = [{"role": "user", "content": "hi"}]
    main.clear_session(7)
    assert "7" not in main._sessions


def test_clear_session_on_unknown_user_is_a_noop():
    main.clear_session(999999)


# --- chat() ------------------------------------------------------------

def test_chat_returns_text_on_end_turn(monkeypatch):
    main.clear_session(1)
    response = make_response([make_block("text", text="Hello there")], "end_turn")
    monkeypatch.setattr(main.client.messages, "create", lambda **kw: response)

    result = main.chat("hi", user_id=1)

    assert result == "Hello there"


def test_chat_runs_tool_then_returns_final_text(monkeypatch):
    main.clear_session(2)
    monkeypatch.setitem(main.TOOL_HANDLERS, "get_expenses", lambda **kw: [])

    tool_block = make_block("tool_use", name="get_expenses", input={}, id="tool_1")
    responses = [
        make_response([tool_block], "tool_use"),
        make_response([make_block("text", text="No expenses found")], "end_turn"),
    ]

    def fake_create(**kw):
        return responses.pop(0)

    monkeypatch.setattr(main.client.messages, "create", fake_create)

    result = main.chat("what did I spend?", user_id=2)

    assert result == "No expenses found"
    assert responses == []


# --- stream_chat() -------------------------------------------------------

class FakeStream:
    def __init__(self, chunks, final):
        self._chunks = chunks
        self._final = final

    @property
    def text_stream(self):
        return iter(self._chunks)

    def get_final_message(self):
        return self._final

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def test_stream_chat_yields_text_chunks_on_end_turn(monkeypatch):
    main.clear_session(3)
    final = make_response([make_block("text", text="Hi!")], "end_turn")
    monkeypatch.setattr(main.client.messages, "stream", lambda **kw: FakeStream(["Hi", "!"], final))

    chunks = list(main.stream_chat("hello", user_id=3))

    assert chunks == ["Hi", "!"]


def test_stream_chat_runs_tool_then_streams_final_text(monkeypatch):
    main.clear_session(4)
    monkeypatch.setitem(main.TOOL_HANDLERS, "get_expenses", lambda **kw: [])

    tool_block = make_block("tool_use", name="get_expenses", input={}, id="tool_1")
    streams = [
        FakeStream([], make_response([tool_block], "tool_use")),
        FakeStream(["No", " expenses"], make_response([make_block("text", text="No expenses")], "end_turn")),
    ]

    def fake_stream(**kw):
        return streams.pop(0)

    monkeypatch.setattr(main.client.messages, "stream", fake_stream)

    chunks = list(main.stream_chat("what did I spend?", user_id=4))

    assert chunks == ["No", " expenses"]
    assert streams == []


def test_stream_chat_inserts_space_between_turns_missing_one(monkeypatch):
    main.clear_session(5)
    monkeypatch.setitem(main.TOOL_HANDLERS, "get_expenses", lambda **kw: [])

    tool_block = make_block("tool_use", name="get_expenses", input={}, id="tool_1")
    streams = [
        FakeStream(["I'll log both today."], make_response([tool_block], "tool_use")),
        FakeStream(["Done!"], make_response([make_block("text", text="Done!")], "end_turn")),
    ]

    def fake_stream(**kw):
        return streams.pop(0)

    monkeypatch.setattr(main.client.messages, "stream", fake_stream)

    chunks = list(main.stream_chat("log two expenses", user_id=5))

    assert "".join(chunks) == "I'll log both today. Done!"


def test_stream_chat_does_not_double_space_when_turn_already_ends_in_space(monkeypatch):
    main.clear_session(6)
    monkeypatch.setitem(main.TOOL_HANDLERS, "get_expenses", lambda **kw: [])

    tool_block = make_block("tool_use", name="get_expenses", input={}, id="tool_2")
    streams = [
        FakeStream(["Logging it. "], make_response([tool_block], "tool_use")),
        FakeStream(["Done!"], make_response([make_block("text", text="Done!")], "end_turn")),
    ]

    def fake_stream(**kw):
        return streams.pop(0)

    monkeypatch.setattr(main.client.messages, "stream", fake_stream)

    chunks = list(main.stream_chat("log an expense", user_id=6))

    assert "".join(chunks) == "Logging it. Done!"
