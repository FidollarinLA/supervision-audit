///|
test "comparison exposes removed samples and resolved findings" {
  let before : @supervision_audit.Document = {
    contract: "causal-lm-unshifted-v1",
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
      },
    ],
  }
  let after = { ..before, samples: [], }
  let delta = @supervision_audit.compare(
    @supervision_audit.audit(before),
    @supervision_audit.audit(after),
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
  let result = @json.parse(@supervision_audit.compare_json(a, b))
  assert_true(result is Object(obj) && obj.get("ok") is Some(False))
}
