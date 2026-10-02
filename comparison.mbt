///|
pub(all) struct SampleDelta {
  sample_id : String
  change : String
  before_supervised : Int?
  after_supervised : Int?
  supervised_delta : Int?
} derive(ToJson)

///|
pub extend SampleDelta with ToJson::{to_json}

///|
pub(all) struct Comparison {
  before_status : String
  after_status : String
  samples : Array[SampleDelta]
  new_findings : Array[Finding]
  resolved_findings : Array[Finding]
} derive(ToJson)

///|
pub extend Comparison with ToJson::{to_json}

///|
fn same_finding(a : Finding, b : Finding) -> Bool {
  a.code == b.code && a.sample_id == b.sample_id && a.token_index == b.token_index && a.severity == b.severity
}

///|
/// Compare diagnostic evidence and declared label coverage by stable sample ID.
/// A change in coverage is not itself a claim about model quality.
pub fn compare(before : Report, after : Report) -> Comparison {
  let samples : Array[SampleDelta] = []
  for b in before.samples {
    let mut found : SampleReport? = None
    for a in after.samples { if a.id == b.id { found = Some(a); break } }
    match found {
      Some(a) => samples.push({ sample_id: b.id, change: if a.supervised_tokens == b.supervised_tokens && a.tokens == b.tokens { "stable" } else { "changed" }, before_supervised: Some(b.supervised_tokens), after_supervised: Some(a.supervised_tokens), supervised_delta: Some(a.supervised_tokens - b.supervised_tokens) })
      None => samples.push({ sample_id: b.id, change: "removed", before_supervised: Some(b.supervised_tokens), after_supervised: None, supervised_delta: None })
    }
  }
  for a in after.samples {
    if !before.samples.any(fn(b) { b.id == a.id }) {
      samples.push({ sample_id: a.id, change: "added", before_supervised: None, after_supervised: Some(a.supervised_tokens), supervised_delta: None })
    }
  }
  { before_status: before.status, after_status: after.status, samples,
    new_findings: after.findings.filter(fn(a) { !before.findings.any(fn(b) { same_finding(a, b) }) }),
    resolved_findings: before.findings.filter(fn(b) { !after.findings.any(fn(a) { same_finding(a, b) }) }) }
}

///|
#export_name("compare_json")
pub fn compare_json(before_text : String, after_text : String) -> String {
  if before_text.length() > 1048576 || after_text.length() > 1048576 { return error_json("Comparison input limit exceeded") }
  try {
    let before = decode_document(before_text)
    let after = decode_document(after_text)
    if before.contract != after.contract || before.allowed_roles != after.allowed_roles {
      return error_json("Comparison requires identical contracts and role policies")
    }
    let b = audit(before)
    let a = audit(after)
    if b.findings.any(fn(f) { f.code == "INVALID_SAMPLE_ID" || f.code == "UNSUPPORTED_CONTRACT" || f.code == "RESOURCE_LIMIT" }) || a.findings.any(fn(f) { f.code == "INVALID_SAMPLE_ID" || f.code == "UNSUPPORTED_CONTRACT" || f.code == "RESOURCE_LIMIT" }) {
      return error_json("Comparison requires supported, uniquely identified samples within resource limits")
    }
    let result : Json = { "ok": true, "comparison": compare(b, a).to_json() }
    result.stringify()
  } catch {
    error => error_json(error.to_string())
  }
}
