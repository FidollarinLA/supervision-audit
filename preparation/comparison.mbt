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
/// Low-level operation: callers must validate policies, IDs and resource limits.
/// Prefer compare_documents when comparing documents from an external caller.
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
/// Compare documents only when their effective policies and sample identity
/// permit a meaningful comparison. Sample-level audit failures remain comparable
/// so an engineer can inspect a repair. Err explains rejected comparisons.
pub fn compare_documents(
  before : Document,
  after : Document,
) -> Result[Comparison, String] {
  if before.contract != after.contract ||
    effective_boundary(before) != effective_boundary(after) ||
    before.allowed_roles != after.allowed_roles {
    return Err(
      "Comparison requires identical contracts, role and boundary policies",
    )
  }
  let b = audit(before)
  let a = audit(after)
  let blocking_codes = [
    "INVALID_SAMPLE_ID", "UNSUPPORTED_CONTRACT", "INVALID_BOUNDARY_POLICY", "EMPTY_POLICY",
    "INVALID_POLICY_ROLE", "RESOURCE_LIMIT", "INVALID_EXPECTED_SUPERVISION", "EXPECTED_SUPERVISION_CONFLICT",
  ]
  if b.findings.any(fn(f) { blocking_codes.contains(f.code) }) ||
    a.findings.any(fn(f) { blocking_codes.contains(f.code) }) {
    return Err(
      "Comparison requires supported policies, valid expected evidence and uniquely identified samples within resource limits",
    )
  }
  let before_evidence : Map[String, ExpectedSupervision?] = Map([])
  for sample in before.samples {
    before_evidence[sample.id] = sample.expected_supervision
  }
  for sample in after.samples {
    if before_evidence.get(sample.id) is Some(e) &&
      e != sample.expected_supervision {
      return Err(
        "Comparison requires identical expected evidence for each shared sample; removal or replacement is not a repair",
      )
    }
  }
  Ok(compare(b, a))
}

///|
#export_name("compare_json")
pub fn compare_json(before_text : String, after_text : String) -> String {
  if before_text.length() > 1048576 || after_text.length() > 1048576 {
    return error_json("Comparison input limit exceeded")
  }
  try {
    match
      compare_documents(
        decode_document(before_text),
        decode_document(after_text),
      ) {
      Err(message) => error_json(message)
      Ok(comparison) => {
        let result : Json = { "ok": true, "comparison": comparison.to_json() }
        result.stringify()
      }
    }
  } catch {
    error => error_json(error.to_string())
  }
}
