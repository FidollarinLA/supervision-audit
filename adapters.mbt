///|
pub(all) struct PreprocessedRow {
  id : String?
  input_ids : Array[Int]
  labels : Array[Int]
  attention_mask : Array[Int]
  spans : Array[Span]?
  segments : Array[Segment]?
  original_supervised_tokens : Int?
} derive(FromJson)

///|
pub extend PreprocessedRow with @json.FromJson::{from_json}

///|
/// Audit JSONL exports of already-tokenized training rows. Role/source metadata
/// is optional and stays unknown when absent. The declared label contract is fixed.
#export_name("audit_jsonl")
pub fn audit_jsonl(text : String, policy_text : String) -> String {
  if text.length() > 1048576 {
    return error_json("JSONL input exceeds 1048576 UTF-16 code units")
  }
  try {
    let allowed : Array[String] = @json.from_json(@json.parse(policy_text))
    let samples : Array[Sample] = []
    let mut line_number = 0
    for line in text.split("\n") {
      line_number = line_number + 1
      if line.trim().is_empty() {
        continue
      }
      if samples.length() >= 200 {
        return error_json("JSONL supports at most 200 rows")
      }
      let parsed = @json.parse(line)
      if parsed is Object(fields) {
        for key in ["id", "spans", "segments", "original_supervised_tokens"] {
          if fields.get(key) is Some(Null) {
            fields.remove(key) |> ignore
          }
        }
      }
      let row : PreprocessedRow = @json.from_json(parsed)
      samples.push({
        id: row.id.unwrap_or("row-\{line_number}"),
        input_ids: row.input_ids,
        labels: row.labels,
        attention_mask: row.attention_mask,
        spans: row.spans.unwrap_or([]),
        segments: row.segments.unwrap_or([]),
        original_supervised_tokens: row.original_supervised_tokens,
      })
    }
    let doc : Document = {
      contract: "causal-lm-unshifted-v1",
      allowed_roles: allowed,
      samples,
    }
    let result : Json = { "ok": true, "report": audit(doc).to_json() }
    result.stringify()
  } catch {
    error => error_json("JSONL decoding failed: \{error.to_string()}")
  }
}
