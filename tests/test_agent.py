import types

from agent import db, main


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


def test_run_tools_returns_error_result_for_failing_handler_and_still_runs_the_rest(monkeypatch):
    # A batch tool-use turn (e.g. saving many transactions parsed from bank
    # screenshots) must never let one bad call swallow the tool_results for
    # every other call in the same batch, or leave the assistant's tool_use
    # message in session history with no matching tool_result at all — either
    # would corrupt the conversation for every future turn.
    def failing_handler(**kw):
        raise ValueError("boom")

    monkeypatch.setitem(main.TOOL_HANDLERS, "save_expense", failing_handler)
    monkeypatch.setitem(main.TOOL_HANDLERS, "get_expenses", lambda **kw: {"ok": True})

    blocks = [
        make_block("tool_use", name="get_expenses", input={}, id="tool_1"),
        make_block("tool_use", name="save_expense", input={"amount": 5}, id="tool_2"),
        make_block("tool_use", name="get_expenses", input={}, id="tool_3"),
    ]

    results = main._run_tools(blocks, user_id=1)

    assert [r["tool_use_id"] for r in results] == ["tool_1", "tool_2", "tool_3"]
    assert results[0]["content"] == str({"ok": True})
    assert "error" in results[1]["content"]
    assert results[2]["content"] == str({"ok": True})


# --- _serialize_block --------------------------------------------------------
# Required for persisting assistant turns to Postgres — a live Anthropic SDK
# response block in production, but test doubles are plain dicts or
# SimpleNamespace, so this must handle all three shapes.

def test_serialize_block_passes_through_plain_dicts():
    block = {"type": "text", "text": "hi"}
    assert main._serialize_block(block) is block


def test_serialize_block_uses_model_dump_when_available():
    class FakeSdkBlock:
        def model_dump(self):
            return {"type": "tool_use", "id": "t1", "name": "save_expense", "input": {}}

    assert main._serialize_block(FakeSdkBlock()) == {"type": "tool_use", "id": "t1", "name": "save_expense", "input": {}}


def test_serialize_block_falls_back_to_vars_for_simplenamespace():
    block = make_block("text", text="hi")
    assert main._serialize_block(block) == {"type": "text", "text": "hi"}


# --- _get_session_lock --------------------------------------------------------

def test_get_session_lock_returns_same_lock_for_same_user_id():
    assert main._get_session_lock(123) is main._get_session_lock(123)


def test_get_session_lock_returns_different_locks_for_different_user_ids():
    assert main._get_session_lock(123) is not main._get_session_lock(456)


# --- _repair_dangling_tool_use ---------------------------------------------
# Content blocks here are plain dicts, not make_block()/SimpleNamespace —
# that's what messages actually contain once persisted (see _serialize_block
# above), and what _repair_dangling_tool_use's dict-style access expects.

def test_repair_dangling_tool_use_drops_unresolved_trailing_assistant_message():
    messages = [
        {"role": "user", "content": "log $5 coffee"},
        {"role": "assistant", "content": [{"type": "tool_use", "name": "save_expense", "input": {}, "id": "tool_1"}]},
    ]

    main._repair_dangling_tool_use(messages)

    assert messages == [{"role": "user", "content": "log $5 coffee"}]


def test_repair_dangling_tool_use_leaves_resolved_history_untouched():
    messages = [
        {"role": "user", "content": "log $5 coffee"},
        {"role": "assistant", "content": [{"type": "tool_use", "name": "save_expense", "input": {}, "id": "tool_1"}]},
        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "tool_1", "content": "{}"}]},
    ]
    original = list(messages)

    main._repair_dangling_tool_use(messages)

    assert messages == original


def test_repair_dangling_tool_use_leaves_plain_text_turn_untouched():
    messages = [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": [{"type": "text", "text": "Hello!"}]},
    ]
    original = list(messages)

    main._repair_dangling_tool_use(messages)

    assert messages == original


def test_repair_dangling_tool_use_on_empty_session_is_a_noop():
    main._repair_dangling_tool_use([])  # must not raise


# --- _append_user_turn ------------------------------------------------------

def test_append_user_turn_appends_after_an_assistant_message():
    messages = [{"role": "assistant", "content": [{"type": "text", "text": "hi"}]}]

    main._append_user_turn(messages, "new message")

    assert messages[-1] == {"role": "user", "content": "new message"}
    assert len(messages) == 2


def test_append_user_turn_appends_to_an_empty_session():
    messages: list = []

    main._append_user_turn(messages, "first message")

    assert messages == [{"role": "user", "content": "first message"}]


def test_append_user_turn_merges_into_a_trailing_user_message_instead_of_creating_back_to_back_user_turns():
    # Anthropic's API requires strict user/assistant alternation. Right after
    # _repair_dangling_tool_use drops a corrupted trailing assistant turn,
    # the tail is that turn's original *user* message — appending a second
    # user message on top would violate alternation and trade one 400 error
    # for a different one.
    messages = [{"role": "user", "content": "log these 16 transactions"}]

    main._append_user_turn(messages, "try again")

    assert messages == [{"role": "user", "content": "log these 16 transactions\n\ntry again"}]


def test_append_user_turn_merges_into_a_trailing_tool_results_list_too():
    # A crash partway through a large batch import is likely to corrupt on a
    # *second* tool-calling round, not the first — the SYSTEM prompt calls
    # find_similar_expense before each save_expense, so a big import is
    # naturally round 1 (lookups) then round 2 (saves, where a failure would
    # have hit before this fix). After _repair_dangling_tool_use drops the
    # dangling round-2 assistant message, the tail is round 1's tool_results
    # — a list, not a string. The merge must handle this shape too, or it
    # silently falls through to appending a second user message.
    messages = [{"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "{}"}]}]

    main._append_user_turn(messages, "try again")

    assert messages == [{
        "role": "user",
        "content": [
            {"type": "tool_result", "tool_use_id": "t1", "content": "{}"},
            {"type": "text", "text": "try again"},
        ],
    }]


def test_chat_self_heals_a_session_corrupted_mid_multi_round_tool_use(monkeypatch, user_id_factory):
    # The realistic shape of the reported bug: round 1 (lookups) resolved
    # normally, round 2 (saves) is where a handler crashed, leaving a
    # dangling assistant message whose *preceding* user message is a
    # tool_results list from round 1, not a plain string.
    uid = user_id_factory()
    db.save_chat_session(uid, [
        {"role": "user", "content": "log these 16 transactions"},
        {"role": "assistant", "content": [{"type": "tool_use", "name": "find_similar_expense", "input": {}, "id": "lookup_1"}]},
        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "lookup_1", "content": "[]"}]},
        {"role": "assistant", "content": [{"type": "tool_use", "name": "save_expense", "input": {}, "id": "tool_orphan"}]},
    ])
    captured = {}

    def fake_create(**kw):
        captured["messages"] = kw["messages"]
        return make_response([make_block("text", text="Logged it")], "end_turn")

    monkeypatch.setattr(main.client.messages, "create", fake_create)

    result = main.chat("try again", user_id=uid)

    assert result == "Logged it"
    sent = captured["messages"]
    assert all(sent[i]["role"] != sent[i + 1]["role"] for i in range(len(sent) - 1))
    assert sent[-1]["content"][-1] == {"type": "text", "text": "try again"}


def test_chat_self_heals_a_session_corrupted_by_the_old_bug(monkeypatch, user_id_factory):
    # Simulates a session left over from before _run_tools caught handler
    # exceptions: an assistant tool_use turn with no tool_result ever
    # appended after it, which used to make every future turn fail with
    # Anthropic's "tool_use ids were found without tool_result blocks" error
    # forever. chat() must drop that dangling turn before sending history,
    # and must not just trade that error for a role-alternation error by
    # leaving two consecutive user messages behind.
    uid = user_id_factory()
    db.save_chat_session(uid, [
        {"role": "user", "content": "log these 16 transactions"},
        {"role": "assistant", "content": [{"type": "tool_use", "name": "save_expense", "input": {}, "id": "tool_orphan"}]},
    ])
    captured = {}

    def fake_create(**kw):
        captured["messages"] = kw["messages"]
        return make_response([make_block("text", text="Logged it")], "end_turn")

    monkeypatch.setattr(main.client.messages, "create", fake_create)

    result = main.chat("try again", user_id=uid)

    assert result == "Logged it"
    sent = captured["messages"]
    # The orphaned assistant tool_use message must not be in what gets sent.
    sent_ids = [
        b["id"] for m in sent if m["role"] == "assistant"
        for b in (m["content"] if isinstance(m["content"], list) else [])
        if b.get("type") == "tool_use"
    ]
    assert "tool_orphan" not in sent_ids
    # Roles must strictly alternate — no two consecutive same-role messages.
    assert all(sent[i]["role"] != sent[i + 1]["role"] for i in range(len(sent) - 1))
    # The original message's content wasn't silently dropped, just merged.
    assert sent == [{"role": "user", "content": "log these 16 transactions\n\ntry again"}]


# --- clear_session ---------------------------------------------------------

def test_clear_session_removes_history(user_id_factory):
    uid = user_id_factory()
    db.save_chat_session(uid, [{"role": "user", "content": "hi"}])

    main.clear_session(uid)

    assert db.load_chat_session(uid) == []


def test_clear_session_on_unknown_user_is_a_noop():
    main.clear_session(999999)  # DELETE on a non-matching row is a no-op, must not raise


# --- chat() ------------------------------------------------------------

def test_chat_returns_text_on_end_turn(monkeypatch, user_id_factory):
    uid = user_id_factory()
    response = make_response([make_block("text", text="Hello there")], "end_turn")
    monkeypatch.setattr(main.client.messages, "create", lambda **kw: response)

    result = main.chat("hi", user_id=uid)

    assert result == "Hello there"


def test_chat_runs_tool_then_returns_final_text(monkeypatch, user_id_factory):
    uid = user_id_factory()
    monkeypatch.setitem(main.TOOL_HANDLERS, "get_expenses", lambda **kw: [])

    tool_block = make_block("tool_use", name="get_expenses", input={}, id="tool_1")
    responses = [
        make_response([tool_block], "tool_use"),
        make_response([make_block("text", text="No expenses found")], "end_turn"),
    ]

    def fake_create(**kw):
        return responses.pop(0)

    monkeypatch.setattr(main.client.messages, "create", fake_create)

    result = main.chat("what did I spend?", user_id=uid)

    assert result == "No expenses found"
    assert responses == []


def test_chat_persists_conversation_to_the_database(monkeypatch, user_id_factory):
    # The whole point of externalizing session storage: nothing about this
    # depends on process memory, so it survives a restart between requests.
    # This test can't simulate an actual restart, but proves the underlying
    # mechanism — everything chat() needs is read back correctly from what a
    # prior call wrote, not from anything still sitting in memory.
    uid = user_id_factory()
    response = make_response([make_block("text", text="Hello there")], "end_turn")
    monkeypatch.setattr(main.client.messages, "create", lambda **kw: response)

    main.chat("hi", user_id=uid)

    saved = db.load_chat_session(uid)
    assert saved[0] == {"role": "user", "content": "hi"}
    assert saved[1]["role"] == "assistant"
    assert saved[1]["content"] == [{"type": "text", "text": "Hello there"}]


def test_chat_appends_to_previously_persisted_history_across_calls(monkeypatch, user_id_factory):
    uid = user_id_factory()
    response = make_response([make_block("text", text="ok")], "end_turn")
    monkeypatch.setattr(main.client.messages, "create", lambda **kw: response)

    main.chat("first message", user_id=uid)
    main.chat("second message", user_id=uid)

    saved = db.load_chat_session(uid)
    user_texts = [m["content"] for m in saved if m["role"] == "user" and isinstance(m["content"], str)]
    assert user_texts == ["first message", "second message"]


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


def test_stream_chat_yields_text_chunks_on_end_turn(monkeypatch, user_id_factory):
    uid = user_id_factory()
    final = make_response([make_block("text", text="Hi!")], "end_turn")
    monkeypatch.setattr(main.client.messages, "stream", lambda **kw: FakeStream(["Hi", "!"], final))

    events = list(main.stream_chat("hello", user_id=uid))

    assert events == [{"text": "Hi"}, {"text": "!"}]


def test_stream_chat_runs_tool_then_streams_final_text(monkeypatch, user_id_factory):
    uid = user_id_factory()
    monkeypatch.setitem(main.TOOL_HANDLERS, "get_expenses", lambda **kw: [])

    tool_block = make_block("tool_use", name="get_expenses", input={}, id="tool_1")
    streams = [
        FakeStream([], make_response([tool_block], "tool_use")),
        FakeStream(["No", " expenses"], make_response([make_block("text", text="No expenses")], "end_turn")),
    ]

    def fake_stream(**kw):
        return streams.pop(0)

    monkeypatch.setattr(main.client.messages, "stream", fake_stream)

    events = list(main.stream_chat("what did I spend?", user_id=uid))

    assert events == [
        {"status": "Looking up expenses…"},
        {"text": "No"},
        {"text": " expenses"},
    ]
    assert streams == []


def test_stream_chat_emits_breakdown_event_for_category_breakdown_tool(monkeypatch, user_id_factory):
    uid = user_id_factory()
    breakdown_result = {
        "breakdown": [{"category": "Dining", "total": 42.0, "count": 3, "pct": 100.0}],
        "grand_total": 42.0,
    }
    monkeypatch.setitem(main.TOOL_HANDLERS, "get_category_breakdown", lambda **kw: breakdown_result)

    tool_block = make_block("tool_use", name="get_category_breakdown", input={}, id="tool_1")
    streams = [
        FakeStream([], make_response([tool_block], "tool_use")),
        FakeStream(["Here you go"], make_response([make_block("text", text="Here you go")], "end_turn")),
    ]

    def fake_stream(**kw):
        return streams.pop(0)

    monkeypatch.setattr(main.client.messages, "stream", fake_stream)

    events = list(main.stream_chat("breakdown please", user_id=uid))

    assert events == [
        {"status": "Calculating breakdown…"},
        {"breakdown": breakdown_result},
        {"text": "Here you go"},
    ]


def test_stream_chat_emits_status_for_unmapped_tool(monkeypatch, user_id_factory):
    uid = user_id_factory()
    monkeypatch.setitem(main.TOOL_HANDLERS, "some_new_tool", lambda **kw: [])

    tool_block = make_block("tool_use", name="some_new_tool", input={}, id="tool_1")
    streams = [
        FakeStream([], make_response([tool_block], "tool_use")),
        FakeStream(["Done"], make_response([make_block("text", text="Done")], "end_turn")),
    ]

    def fake_stream(**kw):
        return streams.pop(0)

    monkeypatch.setattr(main.client.messages, "stream", fake_stream)

    events = list(main.stream_chat("do something new", user_id=uid))

    assert events[0] == {"status": "Working…"}


def test_stream_chat_emits_status_for_images(monkeypatch, user_id_factory):
    uid = user_id_factory()
    final = make_response([make_block("text", text="Logged!")], "end_turn")
    monkeypatch.setattr(main.client.messages, "stream", lambda **kw: FakeStream(["Logged!"], final))
    monkeypatch.setattr(main, "_ocr_image", lambda data, media_type: "Total: $5")

    events = list(main.stream_chat("log this", user_id=uid, images=[{"data": "x", "media_type": "image/png"}]))

    assert events[0] == {"status": "Reading image…"}


def test_stream_chat_inserts_space_between_turns_missing_one(monkeypatch, user_id_factory):
    uid = user_id_factory()
    monkeypatch.setitem(main.TOOL_HANDLERS, "get_expenses", lambda **kw: [])

    tool_block = make_block("tool_use", name="get_expenses", input={}, id="tool_1")
    streams = [
        FakeStream(["I'll log both today."], make_response([tool_block], "tool_use")),
        FakeStream(["Done!"], make_response([make_block("text", text="Done!")], "end_turn")),
    ]

    def fake_stream(**kw):
        return streams.pop(0)

    monkeypatch.setattr(main.client.messages, "stream", fake_stream)

    events = list(main.stream_chat("log two expenses", user_id=uid))
    text = "".join(e["text"] for e in events if "text" in e)

    assert text == "I'll log both today. Done!"


def test_stream_chat_does_not_double_space_when_turn_already_ends_in_space(monkeypatch, user_id_factory):
    uid = user_id_factory()
    monkeypatch.setitem(main.TOOL_HANDLERS, "get_expenses", lambda **kw: [])

    tool_block = make_block("tool_use", name="get_expenses", input={}, id="tool_2")
    streams = [
        FakeStream(["Logging it. "], make_response([tool_block], "tool_use")),
        FakeStream(["Done!"], make_response([make_block("text", text="Done!")], "end_turn")),
    ]

    def fake_stream(**kw):
        return streams.pop(0)

    monkeypatch.setattr(main.client.messages, "stream", fake_stream)

    events = list(main.stream_chat("log an expense", user_id=uid))
    text = "".join(e["text"] for e in events if "text" in e)

    assert text == "Logging it. Done!"
