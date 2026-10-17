///|
fn expected_sample() -> @preparation.Sample {
  {
    id: "expected",
    input_ids: [1, 2, 3, 4],
    labels: [-100, 2, 3, -100],
    attention_mask: [1, 1, 1, 1],
    spans: [{ start: 0, end: 4, role: "text", }],
    segments: [{ start: 0, end: 4, source_id: "original", }],
    original_supervised_tokens: None,
    expected_supervision: Some({
      schema: "causal-target-mask-v1",
      source: "independent exporter v1",
      mask: [0, 1, 1, 0],
    }),
  }
}

///|
fn expected_document(s : @preparation.Sample) -> @preparation.Document {
  {
    contract: "causal-lm-unshifted-v1",
    allowed_roles: ["text"],
    boundary_policy: None,
    samples: [s],
  }
}

///|
test "optional evidence stays optional and cannot verify missing provenance" {
  let s = expected_sample()
  let r = @preparation.audit(expected_document(s))
  assert_eq(r.status, "pass")
  assert_eq(r.report_schema, "supervision-audit-report-v2")
  assert_eq(r.samples[0].expectation_status, "matched")
  assert_eq(r.samples[0].expected_target_indices, Some([1, 2]))
  assert_eq(
    @preparation.audit(expected_document({ ..s, expected_supervision: None, })).samples[0].expectation_status,
    "not-provided",
  )
  let unknown = @preparation.audit(
    expected_document({ ..s, spans: [], segments: [], }),
  )
  assert_eq(unknown.status, "review")
  assert_eq(unknown.samples[0].expectation_status, "matched")
  assert_true(unknown.unknown_count > 0)
}

///|
test "independent mask detects missing and extra targets at exact positions" {
  let s = { ..expected_sample(), labels: [-100, -100, 3, 4], }
  let r = @preparation.audit(expected_document(s))
  assert_eq(r.error_count, 2)
  assert_eq(r.samples[0].expectation_status, "mismatch")
  assert_true(
    r.findings.any(fn(f) {
      f.code == "EXPECTED_TARGET_MISSING" && f.token_index == Some(1)
    }),
  )
  assert_true(
    r.findings.any(fn(f) {
      f.code == "UNEXPECTED_TARGET" && f.token_index == Some(3)
    }),
  )
  assert_eq(r.samples[0].states[1], "error")
  assert_eq(r.samples[0].states[3], "error")
  match
    @preparation.compare_documents(
      expected_document(s),
      expected_document(expected_sample()),
    ) {
    Ok(c) => {
      assert_eq(c.resolved_findings.length(), 2)
      assert_eq(c.new_findings.length(), 0)
    }
    Err(e) => fail(e)
  }
}

///|
test "shape version and source validation reject untrustworthy evidence" {
  let s = expected_sample()
  let invalid : Array[@preparation.ExpectedSupervision] = [
    { schema: "other", source: "exporter", mask: [0, 1, 1, 0], },
    { schema: "causal-target-mask-v1", source: " \n ", mask: [0, 1, 1, 0], },
    { schema: "causal-target-mask-v1", source: "exporter", mask: [0, 1], },
    { schema: "causal-target-mask-v1", source: "exporter", mask: [0, 2, 1, 0], },
  ]
  for e in invalid {
    let r = @preparation.audit(
      expected_document({ ..s, expected_supervision: Some(e), }),
    )
    assert_eq(r.samples[0].expectation_status, "invalid")
    assert_eq(r.samples[0].expected_target_indices, None)
    assert_true(
      r.findings.any(fn(f) { f.code == "INVALID_EXPECTED_SUPERVISION" }),
    )
    assert_false(
      r.findings.any(fn(f) {
        f.code == "EXPECTED_TARGET_MISSING" || f.code == "UNEXPECTED_TARGET"
      }),
    )
  }
  let misaligned = @preparation.audit(
    expected_document({ ..s, labels: [-100], }),
  )
  assert_eq(misaligned.samples[0].expectation_status, "invalid")
}

///|
test "expected targets cannot contradict shift padding roles or strict boundaries" {
  let s = expected_sample()
  let e = s.expected_supervision.unwrap()
  let cases = [
    { ..s, expected_supervision: Some({ ..e, mask: [1, 1, 1, 0], }), },
    { ..s, attention_mask: [1, 0, 1, 1], },
    { ..s, spans: [{ start: 0, end: 4, role: "user", }], },
    {
      ..s,
      spans: [
        { start: 0, end: 4, role: "text", },
        { start: 1, end: 2, role: "text", },
      ],
    },
    {
      ..s,
      segments: [
        { start: 0, end: 2, source_id: "a", },
        { start: 2, end: 4, source_id: "b", },
      ],
    },
  ]
  for sample in cases {
    let r = @preparation.audit(expected_document(sample))
    assert_eq(r.samples[0].expectation_status, "invalid")
    assert_true(
      r.findings.any(fn(f) { f.code == "EXPECTED_SUPERVISION_CONFLICT" }),
    )
  }
  let permitted = @preparation.audit({
    ..expected_document(cases[4]),
    boundary_policy: Some("allow-cross-source"),
  })
  assert_eq(permitted.status, "pass")
}

///|
test "position zero alone cannot masquerade as a training target" {
  let s = {
    ..expected_sample(),
    labels: [1, -100, -100, -100],
    expected_supervision: Some({
      schema: "causal-target-mask-v1",
      source: "empty shifted target set",
      mask: [0, 0, 0, 0],
    }),
  }
  let r = @preparation.audit(expected_document(s))
  assert_eq(r.status, "review")
  assert_eq(r.samples[0].expectation_status, "matched")
  assert_eq(r.effective_target_count, 0)
  assert_true(r.findings.any(fn(f) { f.code == "NO_EFFECTIVE_TARGETS" }))
}

///|
test "comparison rejects removed changed invalid or replaced expected evidence" {
  let s = expected_sample()
  let doc = expected_document(s)
  let e = s.expected_supervision.unwrap()
  for
    other in [
      { ..s, expected_supervision: None, },
      { ..s, expected_supervision: Some({ ..e, source: "replacement", }), },
      { ..s, expected_supervision: Some({ ..e, mask: [0, 1, 0, 0], }), },
      { ..s, expected_supervision: Some({ ..e, mask: [1, 1, 1, 0], }), },
    ] {
    assert_true(
      @preparation.compare_documents(doc, expected_document(other)) is Err(_),
    )
    assert_true(
      @preparation.compare_documents(expected_document(other), doc) is Err(_),
    )
  }
}

///|
test "oversized evidence is bounded before expansion" {
  let s = expected_sample()
  let r = @preparation.audit(
    expected_document({
      ..s,
      expected_supervision: Some({
        schema: "causal-target-mask-v1",
        source: "oversized",
        mask: Array::make(10001, 0),
      }),
    }),
  )
  assert_eq(r.samples.length(), 0)
  assert_true(r.findings.any(fn(f) { f.code == "RESOURCE_LIMIT" }))
}
