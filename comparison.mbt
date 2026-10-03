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
fn finding_key(f : Finding) -> String {
  // JSON encodes arbitrary sample IDs without delimiter collisions. Messages
  // are deliberately excluded: comparison identifies the diagnostic location.
  let key : Json = {
    "code": f.code,
    "sample": f.sample_id,
    "token": f.token_index.to_json(),
    "severity": f.severity,
  }
  key.stringify()
}

///|
/// Compare diagnostic evidence and declared label coverage by stable sample ID.
/// A change in coverage is not itself a claim about model quality.
pub fn compare(before : Report, after : Report) -> Comparison {
  let samples : Array[SampleDelta] = []
  let after_samples : Map[String, SampleReport] = Map([])
  let before_ids : Map[String, Bool] = Map([])
  for a in after.samples {
    after_samples[a.id] = a
  }
  for b in before.samples {
    before_ids[b.id] = true
    match after_samples.get(b.id) {
      Some(a) =>
        samples.push({
          sample_id: b.id,
          change: if a.supervised_tokens == b.supervised_tokens &&
            a.tokens == b.tokens {
            "stable"
          } else {
            "changed"
          },
          before_supervised: Some(b.supervised_tokens),
          after_supervised: Some(a.supervised_tokens),
          supervised_delta: Some(a.supervised_tokens - b.supervised_tokens),
        })
      None =>
        samples.push({
          sample_id: b.id,
          change: "removed",
          before_supervised: Some(b.supervised_tokens),
          after_supervised: None,
          supervised_delta: None,
        })
    }
  }
  for a in after.samples {
    if !before_ids.contains(a.id) {
      samples.push({
        sample_id: a.id,
        change: "added",
        before_supervised: None,
        after_supervised: Some(a.supervised_tokens),
        supervised_delta: None,
      })
    }
  }
  let before_keys : Map[String, Bool] = Map([])
  let after_keys : Map[String, Bool] = Map([])
  for f in before.findings {
    before_keys[finding_key(f)] = true
  }
  for f in after.findings {
    after_keys[finding_key(f)] = true
  }
  {
    before_status: before.status,
    after_status: after.status,
    samples,
    new_findings: after.findings.filter(fn(a) {
      !before_keys.contains(finding_key(a))
    }),
    resolved_findings: before.findings.filter(fn(b) {
      !after_keys.contains(finding_key(b))
    }),
  }
}

///|
#export_name("compare_json")
pub fn compare_json(before_text : String, after_text : String) -> String {
  if before_text.length() > 1048576 || after_text.length() > 1048576 {
    return error_json("Comparison input limit exceeded")
  }
  try {
    let before = decode_document(before_text)
    let after = decode_document(after_text)
    if before.contract != after.contract ||
      before.allowed_roles != after.allowed_roles {
      return error_json(
        "Comparison requires identical contracts and role policies",
      )
    }
    let b = audit(before)
    let a = audit(after)
    if b.findings.any(fn(f) {
        f.code == "INVALID_SAMPLE_ID" ||
        f.code == "UNSUPPORTED_CONTRACT" ||
        f.code == "RESOURCE_LIMIT"
      }) ||
      a.findings.any(fn(f) {
        f.code == "INVALID_SAMPLE_ID" ||
        f.code == "UNSUPPORTED_CONTRACT" ||
        f.code == "RESOURCE_LIMIT"
      }) {
      return error_json(
        "Comparison requires supported, uniquely identified samples within resource limits",
      )
    }
    let result : Json = { "ok": true, "comparison": compare(b, a).to_json() }
    result.stringify()
  } catch {
    error => error_json(error.to_string())
  }
}
