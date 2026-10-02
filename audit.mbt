///|
pub(all) struct Span {
  start : Int
  end : Int
  role : String
} derive(FromJson, ToJson)
///|
pub(all) struct Segment {
  start : Int
  end : Int
  source_id : String
} derive(FromJson, ToJson)
///|
pub(all) struct Sample {
  id : String
  input_ids : Array[Int]
  labels : Array[Int]
  attention_mask : Array[Int]
  spans : Array[Span]
  segments : Array[Segment]
  original_supervised_tokens : Int?
} derive(FromJson, ToJson)
///|
pub(all) struct Document {
  contract : String
  allowed_roles : Array[String]
  samples : Array[Sample]
} derive(FromJson, ToJson)
///|
pub(all) struct Finding {
  code : String
  severity : String
  sample_id : String
  token_index : Int?
  message : String
} derive(ToJson)
///|
pub(all) struct SampleReport {
  id : String
  tokens : Int
  supervised_tokens : Int
  supervised_ratio : Double
  roles : Array[String]
  states : Array[String]
  source_ids : Array[String]
  findings : Array[Finding]
} derive(ToJson)
///|
pub(all) struct Report {
  contract : String
  status : String
  sample_count : Int
  token_count : Int
  supervised_tokens : Int
  error_count : Int
  warning_count : Int
  unknown_count : Int
  samples : Array[SampleReport]
  findings : Array[Finding]
} derive(ToJson)
///|
fn finding(code : String, severity : String, id : String, index : Int?, message : String) -> Finding {
  { code, severity, sample_id: id, token_index: index, message }
}
///|
fn check_sample(s : Sample, allowed : Array[String]) -> SampleReport {
  let n = s.input_ids.length()
  let findings : Array[Finding] = []
  let roles = Array::make(n, "unknown")
  let source_ids = Array::make(n, "unknown")
  let states = Array::make(n, "unknown")
  if s.labels.length() != n || s.attention_mask.length() != n {
    findings.push(finding("LENGTH_MISMATCH", "error", s.id, None, "input_ids, labels and attention_mask must have equal lengths"))
  }
  if n == 0 { findings.push(finding("EMPTY_SAMPLE", "error", s.id, None, "Sample has no tokens")) }
  for span in s.spans {
    if span.start < 0 || span.end <= span.start || span.end > n {
      findings.push(finding("SPAN_OUT_OF_BOUNDS", "error", s.id, None, "Role interval must satisfy 0 <= start < end <= token count"))
      continue
    }
    if span.role != "system" && span.role != "user" && span.role != "assistant" && span.role != "tool" {
      findings.push(finding("UNKNOWN_ROLE", "error", s.id, Some(span.start), "Unsupported role"))
    }
    for i = span.start; i < span.end; i = i + 1 {
      if roles[i] != "unknown" {
        findings.push(finding("ROLE_OVERLAP", "error", s.id, Some(i), "Multiple role intervals cover this token"))
        roles[i] = "conflict"
      } else { roles[i] = span.role }
    }
  }
  for segment in s.segments {
    if segment.start > 0 && segment.start < n && segment.start < s.labels.length() && s.labels[segment.start] != -100 {
      findings.push(finding("PACKING_CROSS_SOURCE_TARGET", "error", s.id, Some(segment.start), "Packed source begins with a supervised target; plain causal attention would predict it from the previous source"))
    }
    if segment.start < 0 || segment.end <= segment.start || segment.end > n || segment.source_id == "" {
      findings.push(finding("SEGMENT_INVALID", "error", s.id, None, "Source interval is invalid or source_id is empty"))
      continue
    }
    for i = segment.start; i < segment.end; i = i + 1 {
      if source_ids[i] != "unknown" {
        findings.push(finding("SOURCE_OVERLAP", "error", s.id, Some(i), "Multiple packed sources cover this token"))
        source_ids[i] = "conflict"
      } else { source_ids[i] = segment.source_id }
    }
  }
  let mut supervised = 0
  let mut missing_role = false
  let mut missing_source = false
  for i = 0; i < n; i = i + 1 {
    if roles[i] == "unknown" { missing_role = true }
    if source_ids[i] == "unknown" { missing_source = true }
    if s.input_ids[i] < 0 { findings.push(finding("INVALID_TOKEN_ID", "error", s.id, Some(i), "Token ID must be nonnegative")) }
    if i >= s.labels.length() || i >= s.attention_mask.length() { continue }
    let label = s.labels[i]
    let attention = s.attention_mask[i]
    if attention != 0 && attention != 1 { findings.push(finding("INVALID_ATTENTION", "error", s.id, Some(i), "attention_mask must contain only 0 or 1")) }
    if label == -100 {
      states[i] = if attention == 0 { "padding" } else { "ignored" }
    } else {
      supervised = supervised + 1
      states[i] = "supervised"
      if label != s.input_ids[i] {
        findings.push(finding("LABEL_TOKEN_MISMATCH", "error", s.id, Some(i), "Unshifted label must equal input_ids at the same position, or -100"))
        states[i] = "error"
      }
      if attention == 0 {
        findings.push(finding("PADDING_SUPERVISED", "error", s.id, Some(i), "Padding token unexpectedly contributes a label"))
        states[i] = "error"
      }
      if roles[i] != "unknown" && roles[i] != "conflict" && !allowed.contains(roles[i]) {
        findings.push(finding("ROLE_POLICY_VIOLATION", "error", s.id, Some(i), "Supervised token belongs to a role excluded by this policy"))
        states[i] = "error"
      }
    }
  }
  if missing_role { findings.push(finding("ROLE_PROVENANCE_MISSING", "unknown", s.id, None, "Role coverage is incomplete; uncovered token policy cannot be verified")) }
  if missing_source { findings.push(finding("SOURCE_PROVENANCE_MISSING", "unknown", s.id, None, "Source coverage is incomplete; packed provenance cannot be verified")) }
  if n > 0 && s.labels.length() == n && supervised == 0 { findings.push(finding("NO_SUPERVISION", "warning", s.id, None, "All labels are ignored; sample has no declared supervised tokens")) }
  if n > 0 && !s.labels.is_empty() && s.labels[0] != -100 {
    findings.push(finding("FIRST_TOKEN_NOT_PREDICTED", "warning", s.id, Some(0), "Under model-internal causal shift, label position zero is not predicted"))
  }
  match s.original_supervised_tokens {
    Some(before) => {
      if before < 0 || before < supervised { findings.push(finding("INVALID_BASELINE", "error", s.id, None, "Original supervised count cannot be negative or less than current count")) }
      else if before > supervised { findings.push(finding("SUPERVISION_REDUCED", "warning", s.id, None, "Supervised count decreased from \{before} to \{supervised}; inspect truncation or preprocessing")) }
    }
    None => ()
  }
  { id: s.id, tokens: n, supervised_tokens: supervised,
    supervised_ratio: if n == 0 { 0.0 } else { supervised.to_double() / n.to_double() },
    roles, states, source_ids, findings }
}
///|
/// Audit the explicitly declared, unshifted causal-LM contract.
pub fn audit(doc : Document) -> Report {
  let findings : Array[Finding] = []
  let samples : Array[SampleReport] = []
  let mut token_count = 0
  let mut supervised_tokens = 0
  if doc.contract != "causal-lm-unshifted-v1" { findings.push(finding("UNSUPPORTED_CONTRACT", "error", "", None, "Only causal-lm-unshifted-v1 is supported")) }
  if doc.allowed_roles.is_empty() { findings.push(finding("EMPTY_POLICY", "error", "", None, "allowed_roles must explicitly declare a supervision policy")) }
  for role in doc.allowed_roles {
    if role != "assistant" && role != "user" && role != "system" && role != "tool" { findings.push(finding("INVALID_POLICY_ROLE", "error", "", None, "Policy includes an unsupported role")) }
  }
  if doc.samples.length() > 200 {
    findings.push(finding("RESOURCE_LIMIT", "error", "", None, "At most 200 samples may be audited in one document"))
  }
  if doc.samples.is_empty() { findings.push(finding("EMPTY_DATASET", "error", "", None, "Dataset contains no samples")) }
  let seen : Map[String, Bool] = Map([])
  if doc.contract == "causal-lm-unshifted-v1" && doc.samples.length() <= 200 {
    for s in doc.samples {
      if seen.contains(s.id) || s.id == "" { findings.push(finding("INVALID_SAMPLE_ID", "error", s.id, None, "Sample IDs must be nonempty and unique")) }
      seen[s.id] = true
      if s.input_ids.length() > 10000 || s.spans.length() > 10000 || s.segments.length() > 10000 { findings.push(finding("RESOURCE_LIMIT", "error", s.id, None, "Interactive audit supports at most 10000 tokens and intervals per sample")); continue }
      let mut interval_work = 0
      for span in s.spans {
        if span.start >= 0 && span.end > span.start && span.end <= s.input_ids.length() { interval_work = interval_work + span.end - span.start }
      }
      for segment in s.segments {
        if segment.start >= 0 && segment.end > segment.start && segment.end <= s.input_ids.length() { interval_work = interval_work + segment.end - segment.start }
      }
      if interval_work > 100000 || token_count + s.input_ids.length() > 100000 {
        findings.push(finding("RESOURCE_LIMIT", "error", s.id, None, "Interval expansion or document token budget exceeded"))
        continue
      }
      let report = check_sample(s, doc.allowed_roles)
      token_count = token_count + report.tokens
      supervised_tokens = supervised_tokens + report.supervised_tokens
      for f in report.findings { findings.push(f) }
      samples.push(report)
    }
  }
  let mut error_count = 0
  let mut warning_count = 0
  let mut unknown_count = 0
  for f in findings {
    match f.severity {
      "error" => error_count = error_count + 1
      "warning" => warning_count = warning_count + 1
      _ => unknown_count = unknown_count + 1
    }
  }
  { contract: doc.contract, status: if error_count > 0 { "fail" } else if unknown_count > 0 || warning_count > 0 { "review" } else { "pass" },
    sample_count: samples.length(), token_count, supervised_tokens, error_count, warning_count, unknown_count, samples, findings }
}
///|
#export_name("audit_json")
pub fn audit_json(text : String) -> String {
  if text.length() > 1048576 { return error_json("Input exceeds 1048576 UTF-16 code units") }
  try {
    let doc : Document = @json.from_json(@json.parse(text))
    if doc.samples.length() > 200 { return error_json("Interactive audit supports at most 200 samples") }
    let result : Json = { "ok": true, "report": audit(doc).to_json() }
    result.stringify()
  } catch {
    _ => error_json("Invalid document: check JSON syntax and documented field types")
  }
}

///|
fn error_json(message : String) -> String {
  let result : Json = { "ok": false, "error": message }
  result.stringify()
}

///|
pub extend Span with @json.FromJson::{from_json}

///|
pub extend Segment with @json.FromJson::{from_json}

///|
pub extend Sample with @json.FromJson::{from_json}

///|
pub extend Document with @json.FromJson::{from_json}

///|
pub extend Span with ToJson::{to_json}

///|
pub extend Segment with ToJson::{to_json}

///|
pub extend Sample with ToJson::{to_json}

///|
pub extend Document with ToJson::{to_json}

///|
pub extend Finding with ToJson::{to_json}

///|
pub extend SampleReport with ToJson::{to_json}

///|
pub extend Report with ToJson::{to_json}
