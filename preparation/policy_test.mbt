///|
test "cross-source targets are policy-dependent while padding stays an error" {
  let doc : @preparation.Document = {
    contract: "causal-lm-unshifted-v1",
    allowed_roles: ["text"],
    boundary_policy: Some("allow-cross-source"),
    samples: [
      {
        id: "packed",
        input_ids: [1, 2, 3, 0],
        labels: [-100, 2, 3, -100],
        attention_mask: [1, 1, 1, 0],
        spans: [{ start: 0, end: 4, role: "text", }],
        segments: [
          { start: 0, end: 2, source_id: "a", },
          { start: 2, end: 4, source_id: "b", },
        ],
        original_supervised_tokens: None,
        expected_supervision: None,
      },
    ],
  }
  let permitted = @preparation.audit(doc)
  assert_eq(permitted.status, "pass")
  assert_eq(permitted.boundary_policy, "allow-cross-source")
  assert_eq(permitted.samples[0].effective_target_indices, [1, 2])
  let strict = @preparation.audit({ ..doc, boundary_policy: None, })
  assert_true(
    strict.findings.any(fn(f) { f.code == "PACKING_CROSS_SOURCE_TARGET" }),
  )
  doc.samples[0].labels[3] = 0
  let broken = @preparation.audit(doc)
  assert_eq(broken.effective_target_count, 3)
  assert_true(broken.findings.any(fn(f) { f.code == "PADDING_SUPERVISED" }))
}

///|
test "position zero is declared but cannot create an effective prediction" {
  let doc : @preparation.Document = {
    contract: "causal-lm-unshifted-v1",
    allowed_roles: ["text"],
    boundary_policy: None,
    samples: [
      {
        id: "zero",
        input_ids: [1, 2],
        labels: [1, -100],
        attention_mask: [1, 1],
        spans: [{ start: 0, end: 2, role: "text", }],
        segments: [{ start: 0, end: 2, source_id: "a", }],
        original_supervised_tokens: None,
        expected_supervision: None,
      },
    ],
  }
  let r = @preparation.audit(doc)
  assert_eq(r.supervised_tokens, 1)
  assert_eq(r.effective_target_count, 0)
  assert_eq(r.samples[0].effective_target_indices, [])
  assert_eq(r.status, "review")
  let invalid = @preparation.audit({ ..doc, boundary_policy: Some("guessed"), })
  assert_eq(invalid.status, "fail")
  assert_eq(invalid.samples.length(), 0)
}
