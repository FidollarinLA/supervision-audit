///|
test "raw normalization rejects missing source on every backend" {
  let result = @preparation.normalize_traces_json(
    "{\"rows\":[{\"id\":\"one\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"},{\"role\":\"assistant\",\"content\":\"hello\"}]}]}",
  )
  assert_true(
    @json.parse(result) is Object(obj) && obj.get("ok") is Some(False),
  )
}

///|
test "UTF16 offsets and generated label gate work across backends" {
  let row : @preparation.PreparedRow = {
    id: "unicode",
    source: "authored",
    text: "U 🌓答",
    input_ids: [1, 2, 3],
    attention_mask: [1, 1, 1],
    offsets: [
      { start: 0, end: 1, },
      { start: 2, end: 4, },
      { start: 4, end: 5, },
    ],
    candidates: [
      {
        start: 2,
        end: 5,
        source_start: 2,
        source_end: 5,
        kind: "final_answer",
        role: "assistant",
      },
    ],
  }
  let input : Json = {
    "schema": "rendered-traces-utf16-v1",
    "template_family": "chatml-typed-v1",
    "tokenizer_source": "authored",
    "template_source": "authored",
    "rows": [row.to_json()],
  }
  let result = @json.parse(
    @preparation.prepare_labels_json(
      input.stringify(),
      @preparation.default_training_policy().to_json().stringify(),
    ),
  )
  guard result is Object(obj) else { fail("Object result required") }
  assert_true(obj.get("ok") is Some(True))
  guard obj.get("report") is Some(Object(report)) else {
    fail("Report missing")
  }
  assert_true(report.get("status") is Some(String("pass")))
  guard obj.get("document") is Some(doc_json) else { fail("Document missing") }
  let doc : @preparation.Document = @json.from_json(doc_json)
  assert_eq(doc.samples[0].labels, [-100, 2, 3])
}
