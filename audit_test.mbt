///|
fn sample() -> @supervision_audit.Sample {
  {
    id: "a",
    input_ids: [10, 11, 20, 21],
    labels: [-100, -100, 20, 21],
    attention_mask: [1, 1, 1, 1],
    spans: [
      { start: 0, end: 2, role: "user", },
      { start: 2, end: 4, role: "assistant", },
    ],
    segments: [{ start: 0, end: 4, source_id: "source-a", }],
    original_supervised_tokens: None,
  }
}

///|
fn document(s : @supervision_audit.Sample) -> @supervision_audit.Document {
  {
    contract: "causal-lm-unshifted-v1",
    allowed_roles: ["assistant"],
    samples: [s],
  }
}

///|
fn has(report : @supervision_audit.Report, code : String) -> Bool {
  report.findings.any(fn(f) { f.code == code })
}

///|
test "valid assistant-only data has exact supervised coverage" {
  let report = @supervision_audit.audit(document(sample()))
  assert_eq(report.status, "pass")
  assert_eq(report.supervised_tokens, 2)
  assert_eq(report.samples[0].supervised_ratio, 0.5)
}

///|
test "role supervision is determined by declared policy" {
  let s = sample()
  s.labels[1] = 11
  let doc = document(s)
  assert_true(has(@supervision_audit.audit(doc), "ROLE_POLICY_VIOLATION"))
  let permissive = { ..doc, allowed_roles: ["user", "assistant"], }
  assert_eq(@supervision_audit.audit(permissive).status, "pass")
}

///|
test "mismatched arrays are errors and never crash" {
  let s = { ..sample(), labels: [20], }
  assert_true(has(@supervision_audit.audit(document(s)), "LENGTH_MISMATCH"))
}

///|
test "padding and invalid labels have token-indexed evidence" {
  let s = sample()
  s.attention_mask[2] = 0
  s.labels[3] = 999
  let report = @supervision_audit.audit(document(s))
  assert_true(has(report, "PADDING_SUPERVISED"))
  assert_true(has(report, "LABEL_TOKEN_MISMATCH"))
  assert_eq(report.findings[0].token_index, Some(2))
}

///|
test "absent provenance yields review instead of pass" {
  let s = { ..sample(), spans: [], segments: [], }
  let report = @supervision_audit.audit(document(s))
  assert_eq(report.status, "review")
  assert_eq(report.unknown_count, 2)
}

///|
test "invalid intervals are rejected without indexing outside data" {
  let s = { ..sample(), spans: [{ start: -1, end: 9, role: "assistant", }], }
  assert_true(has(@supervision_audit.audit(document(s)), "SPAN_OUT_OF_BOUNDS"))
}

///|
test "overlapping role and source intervals are errors" {
  let s = sample()
  s.spans.push({ start: 1, end: 3, role: "assistant", })
  s.segments.push({ start: 2, end: 4, source_id: "b", })
  let report = @supervision_audit.audit(document(s))
  assert_true(has(report, "ROLE_OVERLAP"))
  assert_true(has(report, "SOURCE_OVERLAP"))
}

///|
test "packing masks the first target of each following source" {
  let s = {
    ..sample(),
    segments: [
      { start: 0, end: 2, source_id: "a", },
      { start: 2, end: 4, source_id: "b", },
    ],
  }
  assert_true(
    has(@supervision_audit.audit(document(s)), "PACKING_CROSS_SOURCE_TARGET"),
  )
  s.labels[2] = -100
  assert_eq(@supervision_audit.audit(document(s)).status, "pass")
}

///|
test "supervision reduction is a warning without claiming its cause" {
  let s = { ..sample(), original_supervised_tokens: Some(5), }
  assert_true(has(@supervision_audit.audit(document(s)), "SUPERVISION_REDUCED"))
}

///|
test "fully ignored sample is review" {
  let s = { ..sample(), labels: [-100, -100, -100, -100], }
  assert_true(has(@supervision_audit.audit(document(s)), "NO_SUPERVISION"))
}

///|
test "unsupported shifted labels are not interpreted" {
  let doc = { ..document(sample()), contract: "shifted-labels", }
  let report = @supervision_audit.audit(doc)
  assert_true(has(report, "UNSUPPORTED_CONTRACT"))
  assert_eq(report.samples.length(), 0)
}

///|
test "duplicate IDs and empty policies fail" {
  let doc = {
    ..document(sample()),
    samples: [sample(), sample()],
    allowed_roles: [],
  }
  let report = @supervision_audit.audit(doc)
  assert_true(has(report, "INVALID_SAMPLE_ID"))
  assert_true(has(report, "EMPTY_POLICY"))
}

///|
fn bridge_ok(text : String) -> Bool raise {
  match @json.parse(text) {
    Object(obj) =>
      match obj.get("ok") {
        Some(True) => true
        _ => false
      }
    _ => false
  }
}

///|
test "JSON bridge rejects malformed input and wrong field types" {
  assert_true(!bridge_ok(@supervision_audit.audit_json("{")))
  assert_true(!bridge_ok(@supervision_audit.audit_json("{}")))
  assert_true(
    bridge_ok(
      @supervision_audit.audit_json(document(sample()).to_json().stringify()),
    ),
  )
}

///|
test "prediction targets exclude position zero without changing declared counts" {
  let s = sample()
  s.labels[0] = 10
  let doc = { ..document(s), allowed_roles: ["user", "assistant"], }
  let report = @supervision_audit.audit(doc)
  assert_eq(report.supervised_tokens, 3)
  assert_eq(report.prediction_targets, Some(2))
  assert_eq(report.samples[0].prediction_targets, Some(2))
  s.labels[2] = -100
  s.labels[3] = -100
  let zero = @supervision_audit.audit(doc)
  assert_eq(zero.prediction_targets, Some(0))
  assert_true(has(zero, "NO_PREDICTION_TARGETS"))
  assert_eq(zero.status, "review")
}

///|
test "ignored samples have zero targets but invalid arrays remain unknown" {
  let ignored = { ..sample(), labels: [-100, -100, -100, -100], }
  assert_eq(
    @supervision_audit.audit(document(ignored)).prediction_targets,
    Some(0),
  )
  for
    invalid in [
      { ..sample(), labels: [10], },
      { ..sample(), labels: [-100, -100, 99, 21], },
      { ..sample(), input_ids: [-1, 11, 20, 21], },
      { ..sample(), attention_mask: [1, 1, 2, 1], },
    ] {
    let report = @supervision_audit.audit(document(invalid))
    assert_eq(report.prediction_targets, None)
    assert_eq(report.samples[0].prediction_targets, None)
    assert_true(!has(report, "NO_PREDICTION_TARGETS"))
  }
}

///|
test "padding and absent provenance do not suppress model targets" {
  let s = { ..sample(), spans: [], segments: [], }
  s.attention_mask[2] = 0
  let report = @supervision_audit.audit(document(s))
  assert_eq(report.prediction_targets, Some(2))
  assert_eq(report.status, "fail")
  assert_true(has(report, "PADDING_SUPERVISED"))
  assert_true(has(report, "ROLE_PROVENANCE_MISSING"))
}

///|
test "aggregate target count refuses partial and unsupported audits" {
  let good = sample()
  let bad = { ..sample(), id: "b", labels: [10], }
  let mixed = { ..document(good), samples: [good, bad], }
  assert_eq(@supervision_audit.audit(mixed).prediction_targets, None)
  let excessive = { ..sample(), id: "large", input_ids: Array::make(10001, 1), }
  let partial = { ..document(good), samples: [good, excessive], }
  let report = @supervision_audit.audit(partial)
  assert_eq(report.samples.length(), 1)
  assert_eq(report.samples[0].prediction_targets, Some(2))
  assert_eq(report.prediction_targets, None)
  assert_eq(
    @supervision_audit.audit({ ..document(good), contract: "other", }).prediction_targets,
    None,
  )
  assert_eq(
    @supervision_audit.audit({ ..document(good), samples: [], }).prediction_targets,
    None,
  )
}
