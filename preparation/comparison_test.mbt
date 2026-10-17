///|
test "comparison exposes removed samples and resolved findings" {
  let before : @preparation.Document = {
    contract: "causal-lm-unshifted-v1",
    boundary_policy: None,
    allowed_roles: ["assistant"],
    samples: [
      {
        id: "gone",
        input_ids: [1],
        labels: [-100],
        attention_mask: [1],
        spans: [],
        segments: [],
        original_supervised_tokens: None,
        expected_supervision: None,
      },
    ],
  }
  let after = { ..before, samples: [], }
  let delta = @preparation.compare(
    @preparation.audit(before),
    @preparation.audit(after),
  )
  assert_eq(delta.samples[0].change, "removed")
  assert_eq(delta.samples[0].after_supervised, None)
  assert_true(
    delta.resolved_findings.any(fn(f) { f.code == "ROLE_PROVENANCE_MISSING" }),
  )
  assert_true(delta.new_findings.any(fn(f) { f.code == "EMPTY_DATASET" }))
}

///|
test "comparing different contracts is refused" {
  let a =
    #|{"contract":"a","allowed_roles":["assistant"],"samples":[]}
  let b =
    #|{"contract":"b","allowed_roles":["assistant"],"samples":[]}
  let result = @json.parse(@preparation.compare_json(a, b))
  assert_true(result is Object(obj) && obj.get("ok") is Some(False))
}

///|
test "checked typed comparisons reject ambiguous or invalid policies" {
  let doc : @preparation.Document = {
    contract: "causal-lm-unshifted-v1",
    allowed_roles: ["text"],
    boundary_policy: None,
    samples: [
      {
        id: "a",
        input_ids: [1, 2],
        labels: [-100, 2],
        attention_mask: [1, 1],
        spans: [{ start: 0, end: 2, role: "text", }],
        segments: [{ start: 0, end: 2, source_id: "source", }],
        original_supervised_tokens: None,
        expected_supervision: None,
      },
    ],
  }
  let explicit = { ..doc, boundary_policy: Some("mask-cross-source"), }
  assert_true(@preparation.compare_documents(doc, explicit) is Ok(_))
  assert_true(
    @preparation.compare_documents(doc, {
      ..doc,
      boundary_policy: Some("allow-cross-source"),
    })
    is Err(_),
  )
  let duplicate = { ..doc, samples: [doc.samples[0], doc.samples[0]], }
  assert_true(@preparation.compare_documents(duplicate, duplicate) is Err(_))
  let invalid = { ..doc, allowed_roles: [], }
  assert_true(@preparation.compare_documents(invalid, invalid) is Err(_))
  let unsupported = { ..doc, contract: "shifted", }
  assert_true(
    @preparation.compare_documents(unsupported, unsupported) is Err(_),
  )
}
