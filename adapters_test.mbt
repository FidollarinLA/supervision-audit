///|
test "pretokenized rows without provenance remain unverified" {
  let row = #|{"input_ids":[1,2],"labels":[-100,2],"attention_mask":[1,1]}
  let result = @json.parse(@supervision_audit.audit_jsonl(row, "[\"assistant\"]"))
  match result {
    Object(obj) => match obj.get("report") {
      Some(Object(report)) => {
        assert_true(report.get("status") is Some(String("review")))
        assert_true(report.get("unknown_count") is Some(Number(2.0, ..)))
      }
      _ => fail("report missing")
    }
    _ => fail("invalid output")
  }
}
///|
test "JSONL reports malformed rows as input failure" {
  let row = #|{"input_ids":[1],"labels":[-100],"attention_mask":[1]}
  let result = @json.parse(@supervision_audit.audit_jsonl(row + "\n{", "[\"assistant\"]"))
  assert_true(result is Object(obj) && obj.get("ok") is Some(False))
}
