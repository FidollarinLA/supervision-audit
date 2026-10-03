///|
test "plain text pretraining policy checks packing and padding" {
  let doc : @supervision_audit.Document = {
    contract: "causal-lm-unshifted-v1",
    allowed_roles: ["text"],
    samples: [
      {
        id: "packed",
        input_ids: [1, 2, 3, 4, 0],
        labels: [-100, 2, -100, 4, -100],
        attention_mask: [1, 1, 1, 1, 0],
        spans: [{ start: 0, end: 5, role: "text", }],
        segments: [
          { start: 0, end: 2, source_id: "A", },
          { start: 2, end: 5, source_id: "B", },
        ],
        original_supervised_tokens: None,
      },
    ],
  }
  assert_eq(@supervision_audit.audit(doc).status, "pass")
  doc.samples[0].labels[2] = 3
  doc.samples[0].labels[4] = 0
  let report = @supervision_audit.audit(doc)
  assert_eq(report.status, "fail")
  assert_eq(report.samples[0].states[2], "error")
  assert_eq(report.samples[0].states[4], "error")
  assert_true(
    report.findings.any(fn(f) {
      f.code == "PACKING_CROSS_SOURCE_TARGET" && f.token_index == Some(2)
    }),
  )
  assert_true(
    report.findings.any(fn(f) {
      f.code == "PADDING_SUPERVISED" && f.token_index == Some(4)
    }),
  )
}
