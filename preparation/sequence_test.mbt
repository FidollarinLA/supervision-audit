///|
fn length_fixture() -> String {
  "{\"schema\":\"rendered-traces-utf16-v1\",\"template_family\":\"chatml-typed-v1\",\"tokenizer_source\":\"authored\",\"template_source\":\"authored\",\"rows\":[{\"id\":\"one\",\"source\":\"authored\",\"text\":\"Uabcd\",\"input_ids\":[1,2,3,4,5],\"attention_mask\":[1,1,1,1,1],\"offsets\":[{\"start\":0,\"end\":1},{\"start\":1,\"end\":2},{\"start\":2,\"end\":3},{\"start\":3,\"end\":4},{\"start\":4,\"end\":5}],\"candidates\":[{\"start\":2,\"end\":5,\"source_start\":2,\"source_end\":5,\"kind\":\"final_answer\",\"role\":\"assistant\"}]}]}"
}

///|
test "sequence prefix clips labels expectation and source spans on every backend" {
  let result = @json.parse(
    @preparation.prepare_training_json(
      length_fixture(),
      @preparation.default_training_policy().to_json().stringify(),
      "{\"max_length\":3,\"overflow\":\"truncate-right\"}",
    ),
  )
  guard result is Object(fields) else { fail("Object required") }
  assert_true(fields.get("ok") is Some(True))
  guard fields.get("document") is Some(value) else { fail("Document required") }
  let doc : @preparation.Document = @json.from_json(value)
  assert_eq(doc.samples[0].input_ids, [1, 2, 3])
  assert_eq(doc.samples[0].labels, [-100, -100, 3])
  assert_eq(doc.samples[0].spans[1].end, 3)
  assert_eq(doc.samples[0].segments[0].end, 3)
  guard doc.samples[0].expected_supervision is Some(e) else {
    fail("Expectation required")
  }
  assert_eq(e.mask, [0, 0, 1])
  assert_true(e.source.contains("right-prefix-max=3"))
  assert_eq(@preparation.audit(doc).status, "pass")
}

///|
test "sequence overflow and prefixes with no shifted targets reject atomically" {
  let policy = @preparation.default_training_policy().to_json().stringify()
  for
    limits in [
      "{\"max_length\":3,\"overflow\":\"reject\"}", "{\"max_length\":2,\"overflow\":\"truncate-right\"}",
      "{\"max_length\":1,\"overflow\":\"truncate-right\"}", "{\"max_length\":3,\"overflow\":\"left\"}",
      "{\"max_length\":3,\"overflow\":\"reject\",\"ignored\":true}",
    ] {
    let result = @json.parse(
      @preparation.prepare_training_json(length_fixture(), policy, limits),
    )
    guard result is Object(fields) else { fail("Object required") }
    assert_true(fields.get("ok") is Some(False))
    assert_true(fields.get("document") is None)
  }
}

///|
test "sequence no-op preserves prepared document" {
  let policy = @preparation.default_training_policy().to_json().stringify()
  let original = @json.parse(
    @preparation.prepare_labels_json(length_fixture(), policy),
  )
  let bounded = @json.parse(
    @preparation.prepare_training_json(
      length_fixture(),
      policy,
      "{\"max_length\":5,\"overflow\":\"reject\"}",
    ),
  )
  guard original is Object(a) && bounded is Object(b) else {
    fail("Objects required")
  }
  assert_eq(a.get("document"), b.get("document"))
  assert_eq(a.get("report"), b.get("report"))
}

///|
fn multi_turn_fixture() -> String {
  "{\"schema\":\"rendered-traces-utf16-v1\",\"template_family\":\"chatml-typed-v1\",\"tokenizer_source\":\"authored\",\"template_source\":\"authored\",\"rows\":[{\"id\":\"turns\",\"source\":\"authored\",\"text\":\"UabUcd\",\"input_ids\":[1,2,3,4,5,6],\"attention_mask\":[1,1,1,1,1,1],\"offsets\":[{\"start\":0,\"end\":1},{\"start\":1,\"end\":2},{\"start\":2,\"end\":3},{\"start\":3,\"end\":4},{\"start\":4,\"end\":5},{\"start\":5,\"end\":6}],\"candidates\":[{\"start\":1,\"end\":3,\"source_start\":1,\"source_end\":3,\"kind\":\"final_answer\",\"role\":\"assistant\"},{\"start\":4,\"end\":6,\"source_start\":4,\"source_end\":6,\"kind\":\"final_answer\",\"role\":\"assistant\"}]}]}"
}

///|
test "complete-turn truncation keeps the last full answer and refuses mid-turn cuts" {
  let policy = @preparation.default_training_policy().to_json().stringify()
  let kept = @json.parse(
    @preparation.prepare_training_json(
      multi_turn_fixture(),
      policy,
      "{\"max_length\":5,\"overflow\":\"truncate-complete-turns\"}",
    ),
  )
  guard kept is Object(fields) else { fail("Object required") }
  assert_true(fields.get("ok") is Some(True))
  guard fields.get("document") is Some(value) else { fail("Document required") }
  let doc : @preparation.Document = @json.from_json(value)
  assert_eq(doc.samples[0].input_ids, [1, 2, 3])
  assert_eq(doc.samples[0].labels, [-100, 2, 3])
  guard doc.samples[0].expected_supervision is Some(e) else {
    fail("Expectation required")
  }
  assert_true(e.source.contains("complete-turn-max=5"))
  assert_eq(@preparation.audit(doc).status, "pass")
  let mid = @json.parse(
    @preparation.prepare_training_json(
      length_fixture(),
      policy,
      "{\"max_length\":3,\"overflow\":\"truncate-complete-turns\"}",
    ),
  )
  guard mid is Object(mid_fields) else { fail("Object required") }
  assert_true(mid_fields.get("ok") is Some(False))
  assert_true(mid_fields.get("document") is None)
}
