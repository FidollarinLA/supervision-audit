///|
pub(all) struct Span {
  start : Int32
  end : Int32
  role : String
} derive(FromJson, ToJson)

///|
pub(all) struct Segment {
  start : Int32
  end : Int32
  source_id : String
} derive(FromJson, ToJson)

///|
pub(all) struct Sample {
  id : String
  input_ids : Array[Int32]
  labels : Array[Int32]
  attention_mask : Array[Int32]
  spans : Array[Span]
  segments : Array[Segment]
  original_supervised_tokens : Int32?
  expected_supervision : ExpectedSupervision?
} derive(FromJson, ToJson)

///|
/// Caller-provided expected shifted-loss targets, never inferred from labels.
pub(all) struct ExpectedSupervision {
  schema : String
  source : String
  mask : Array[Int32]
} derive(Eq, FromJson, ToJson)

///|
pub(all) struct Document {
  contract : String
  allowed_roles : Array[String]
  boundary_policy : String?
  samples : Array[Sample]
} derive(FromJson, ToJson)

///|
pub(all) struct Finding {
  code : String
  severity : String
  sample_id : String
  token_index : Int32?
  message : String
} derive(ToJson)

///|
pub(all) struct SampleReport {
  id : String
  tokens : Int32
  supervised_tokens : Int32
  effective_target_indices : Array[Int32]
  expectation_status : String
  expectation_source : String?
  expected_target_indices : Array[Int32]?
  supervised_ratio : Double
  roles : Array[String]
  states : Array[String]
  source_ids : Array[String]
  findings : Array[Finding]
} derive(ToJson)

///|
pub(all) struct Report {
  report_schema : String
  contract : String
  boundary_policy : String
  status : String
  sample_count : Int32
  token_count : Int32
  supervised_tokens : Int32
  effective_target_count : Int32
  error_count : Int32
  warning_count : Int32
  unknown_count : Int32
  samples : Array[SampleReport]
  findings : Array[Finding]
} derive(ToJson)

///|
fn finding(
  code : String,
  severity : String,
  id : String,
  index : Int32?,
  message : String,
) -> Finding {
  { code, severity, sample_id: id, token_index: index, message, }
}

///|
fn check_sample(
  s : Sample,
  allowed : Array[String],
  boundary : String,
  details~ : Bool,
) -> (SampleReport, Int32) {
  let n = s.input_ids.length()
  let findings : Array[Finding] = []
  let roles = Array::make(n, "unknown")
  let source_ids = Array::make(n, "unknown")
  let states = if details { Array::make(n, "unknown") } else { [] }
  if s.labels.length() != n || s.attention_mask.length() != n {
    findings.push(
      finding(
        "LENGTH_MISMATCH",
        "error",
        s.id,
        None,
        "input_ids, labels and attention_mask must have equal lengths",
      ),
    )
  }
  if n == 0 {
    findings.push(
      finding("EMPTY_SAMPLE", "error", s.id, None, "Sample has no tokens"),
    )
  }
  for span in s.spans {
    if span.start < 0 || span.end <= span.start || span.end > n {
      findings.push(
        finding(
          "SPAN_OUT_OF_BOUNDS",
          "error",
          s.id,
          None,
          "Role interval must satisfy 0 <= start < end <= token count",
        ),
      )
      continue
    }
    if span.role != "system" &&
      span.role != "user" &&
      span.role != "assistant" &&
      span.role != "tool" &&
      span.role != "text" {
      findings.push(
        finding(
          "UNKNOWN_ROLE",
          "error",
          s.id,
          Some(span.start),
          "Unsupported role",
        ),
      )
    }
    for i = span.start; i < span.end; i = i + 1 {
      if roles[i] != "unknown" {
        findings.push(
          finding(
            "ROLE_OVERLAP",
            "error",
            s.id,
            Some(i),
            "Multiple role intervals cover this token",
          ),
        )
        roles[i] = "conflict"
      } else {
        roles[i] = span.role
      }
    }
  }
  for segment in s.segments {
    if boundary == "mask-cross-source" &&
      segment.start > 0 &&
      segment.start < n &&
      segment.start < s.labels.length() &&
      s.labels[segment.start] != -100 {
      findings.push(
        finding(
          "PACKING_CROSS_SOURCE_TARGET",
          "error",
          s.id,
          Some(segment.start),
          "Packed source begins with a supervised target; plain causal attention would predict it from the previous source",
        ),
      )
    }
    if segment.start < 0 ||
      segment.end <= segment.start ||
      segment.end > n ||
      segment.source_id == "" {
      findings.push(
        finding(
          "SEGMENT_INVALID",
          "error",
          s.id,
          None,
          "Source interval is invalid or source_id is empty",
        ),
      )
      continue
    }
    for i = segment.start; i < segment.end; i = i + 1 {
      if source_ids[i] != "unknown" {
        findings.push(
          finding(
            "SOURCE_OVERLAP",
            "error",
            s.id,
            Some(i),
            "Multiple packed sources cover this token",
          ),
        )
        source_ids[i] = "conflict"
      } else {
        source_ids[i] = segment.source_id
      }
    }
  }
  let mut supervised = 0
  let effective_target_indices : Array[Int32] = []
  let mut effective_targets = 0
  let mut missing_role = false
  let mut missing_source = false
  for i = 0; i < n; i = i + 1 {
    if roles[i] == "unknown" {
      missing_role = true
    }
    if source_ids[i] == "unknown" {
      missing_source = true
    }
    if s.input_ids[i] < 0 {
      findings.push(
        finding(
          "INVALID_TOKEN_ID",
          "error",
          s.id,
          Some(i),
          "Token ID must be nonnegative",
        ),
      )
    }
    if i >= s.labels.length() || i >= s.attention_mask.length() {
      continue
    }
    let label = s.labels[i]
    let attention = s.attention_mask[i]
    if attention != 0 && attention != 1 {
      findings.push(
        finding(
          "INVALID_ATTENTION",
          "error",
          s.id,
          Some(i),
          "attention_mask must contain only 0 or 1",
        ),
      )
    }
    if label == -100 {
      if details {
        states[i] = if attention == 0 { "padding" } else { "ignored" }
      }
    } else {
      supervised = supervised + 1
      // The loss shifts labels[1:] against logits[:-1]. attention_mask is
      // not a loss mask; erroneous padding labels still enter this list.
      if i > 0 {
        effective_targets = effective_targets + 1
        if details {
          effective_target_indices.push(i)
        }
      }
      if details {
        states[i] = "supervised"
      }
      if label != s.input_ids[i] {
        findings.push(
          finding(
            "LABEL_TOKEN_MISMATCH",
            "error",
            s.id,
            Some(i),
            "Unshifted label must equal input_ids at the same position, or -100",
          ),
        )
        if details {
          states[i] = "error"
        }
      }
      if attention == 0 {
        findings.push(
          finding(
            "PADDING_SUPERVISED",
            "error",
            s.id,
            Some(i),
            "Padding token unexpectedly contributes a label",
          ),
        )
        if details {
          states[i] = "error"
        }
      }
      if roles[i] != "unknown" &&
        roles[i] != "conflict" &&
        !allowed.contains(roles[i]) {
        findings.push(
          finding(
            "ROLE_POLICY_VIOLATION",
            "error",
            s.id,
            Some(i),
            "Supervised token belongs to a role excluded by this policy",
          ),
        )
        if details {
          states[i] = "error"
        }
      }
    }
  }
  if missing_role {
    findings.push(
      finding(
        "ROLE_PROVENANCE_MISSING",
        "unknown",
        s.id,
        None,
        "Role coverage is incomplete; uncovered token policy cannot be verified",
      ),
    )
  }
  if missing_source {
    findings.push(
      finding(
        "SOURCE_PROVENANCE_MISSING",
        "unknown",
        s.id,
        None,
        "Source coverage is incomplete; packed provenance cannot be verified",
      ),
    )
  }
  if n > 0 && s.labels.length() == n && supervised == 0 {
    findings.push(
      finding(
        "NO_SUPERVISION",
        "warning",
        s.id,
        None,
        "All labels are ignored; sample has no declared supervised tokens",
      ),
    )
  }
  if n > 0 && !s.labels.is_empty() && s.labels[0] != -100 {
    findings.push(
      finding(
        "FIRST_TOKEN_NOT_PREDICTED",
        "warning",
        s.id,
        Some(0),
        "Under model-internal causal shift, label position zero is not predicted",
      ),
    )
  }
  if supervised > 0 && effective_targets == 0 {
    findings.push(
      finding(
        "NO_EFFECTIVE_TARGETS",
        "warning",
        s.id,
        None,
        "Declared labels exist, but none enters model-internal shifted loss",
      ),
    )
  }
  let (expectation_status, expectation_source, expected_target_indices) = check_expectation(
    s,
    allowed,
    boundary,
    roles,
    source_ids,
    findings,
    details~,
  )
  match s.original_supervised_tokens {
    Some(before) =>
      if before < 0 || before < supervised {
        findings.push(
          finding(
            "INVALID_BASELINE",
            "error",
            s.id,
            None,
            "Original supervised count cannot be negative or less than current count",
          ),
        )
      } else if before > supervised {
        findings.push(
          finding(
            "SUPERVISION_REDUCED",
            "warning",
            s.id,
            None,
            "Supervised count decreased from \{before} to \{supervised}; inspect truncation or preprocessing",
          ),
        )
      }
    None => ()
  }
  // Indexed errors also include provenance and packed-boundary diagnostics.
  // Apply them after computing label states so visualization cannot hide them.
  for f in findings {
    if details && f.severity == "error" {
      match f.token_index {
        Some(i) => if i >= 0 && i < n { states[i] = "error" }
        None => ()
      }
    }
  }
  (
    {
      id: s.id,
      tokens: n,
      supervised_tokens: supervised,
      effective_target_indices,
      expectation_status,
      expectation_source,
      expected_target_indices,
      supervised_ratio: if n == 0 {
        0.0
      } else {
        supervised.to_double() / n.to_double()
      },
      roles: if details {
        roles
      } else {
        []
      },
      states,
      source_ids: if details {
        source_ids
      } else {
        []
      },
      findings,
    },
    effective_targets,
  )
}

///|
/// Audit the explicitly declared, unshifted causal-LM contract.
pub fn audit(doc : Document) -> Report {
  audit_internal(doc, details=true)
}

///|
// One set of rules. Count-only results are private and never used as evidence.
fn audit_internal(doc : Document, details~ : Bool) -> Report {
  let findings : Array[Finding] = []
  let samples : Array[SampleReport] = []
  let mut sample_count = 0
  let mut token_count = 0
  let mut supervised_tokens = 0
  let mut effective_target_count = 0
  let boundary = effective_boundary(doc)
  let valid_boundary = boundary == "mask-cross-source" ||
    boundary == "allow-cross-source"
  if !valid_boundary {
    findings.push(
      finding(
        "INVALID_BOUNDARY_POLICY",
        "error",
        "",
        None,
        "boundary_policy must be mask-cross-source or allow-cross-source",
      ),
    )
  }
  if doc.contract != "causal-lm-unshifted-v1" {
    findings.push(
      finding(
        "UNSUPPORTED_CONTRACT",
        "error",
        "",
        None,
        "Only causal-lm-unshifted-v1 is supported",
      ),
    )
  }
  if doc.allowed_roles.is_empty() {
    findings.push(
      finding(
        "EMPTY_POLICY",
        "error",
        "",
        None,
        "allowed_roles must explicitly declare a supervision policy",
      ),
    )
  }
  for role in doc.allowed_roles {
    if role != "assistant" &&
      role != "user" &&
      role != "system" &&
      role != "tool" &&
      role != "text" {
      findings.push(
        finding(
          "INVALID_POLICY_ROLE",
          "error",
          "",
          None,
          "Policy includes an unsupported role",
        ),
      )
    }
  }
  if doc.samples.length() > 200 {
    findings.push(
      finding(
        "RESOURCE_LIMIT",
        "error",
        "",
        None,
        "At most 200 samples may be audited in one document",
      ),
    )
  }
  if doc.samples.is_empty() {
    findings.push(
      finding("EMPTY_DATASET", "error", "", None, "Dataset contains no samples"),
    )
  }
  let seen : Map[String, Bool] = Map([])
  if doc.contract == "causal-lm-unshifted-v1" &&
    valid_boundary &&
    doc.samples.length() <= 200 {
    for s in doc.samples {
      // Non-pass count-only results are never exposed. Stop after the first
      // diagnostic sample, then the full path reconstructs all evidence.
      if !details && !findings.is_empty() {
        break
      }
      if seen.contains(s.id) || s.id == "" {
        findings.push(
          finding(
            "INVALID_SAMPLE_ID",
            "error",
            s.id,
            None,
            "Sample IDs must be nonempty and unique",
          ),
        )
      }
      seen[s.id] = true
      if s.input_ids.length() > 10000 ||
        s.spans.length() > 10000 ||
        s.segments.length() > 10000 ||
        (s.expected_supervision is Some(e) && e.mask.length() > 10000) {
        findings.push(
          finding(
            "RESOURCE_LIMIT",
            "error",
            s.id,
            None,
            "Interactive audit supports at most 10000 tokens and intervals per sample",
          ),
        )
        continue
      }
      let mut interval_work = 0
      for span in s.spans {
        if span.start >= 0 &&
          span.end > span.start &&
          span.end <= s.input_ids.length() {
          interval_work = interval_work + span.end - span.start
        }
      }
      for segment in s.segments {
        if segment.start >= 0 &&
          segment.end > segment.start &&
          segment.end <= s.input_ids.length() {
          interval_work = interval_work + segment.end - segment.start
        }
      }
      if interval_work > 100000 || token_count + s.input_ids.length() > 100000 {
        findings.push(
          finding(
            "RESOURCE_LIMIT",
            "error",
            s.id,
            None,
            "Interval expansion or document token budget exceeded",
          ),
        )
        continue
      }
      let (report, targets) = check_sample(
        s,
        doc.allowed_roles,
        boundary,
        details~,
      )
      sample_count = sample_count + 1
      token_count = token_count + report.tokens
      supervised_tokens = supervised_tokens + report.supervised_tokens
      effective_target_count = effective_target_count + targets
      for f in report.findings {
        findings.push(f)
      }
      if details {
        samples.push(report)
      }
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
  {
    report_schema: "supervision-audit-report-v2",
    contract: doc.contract,
    boundary_policy: boundary,
    status: if error_count > 0 {
      "fail"
    } else if unknown_count > 0 || warning_count > 0 {
      "review"
    } else {
      "pass"
    },
    sample_count,
    token_count,
    supervised_tokens,
    effective_target_count,
    error_count,
    warning_count,
    unknown_count,
    samples,
    findings,
  }
}

///|
#export_name("audit_json")
pub fn audit_json(text : String) -> String {
  audit_json_output(text, summary=false)
}

///|
/// Healthy reports omit per-token diagnostics before JSON construction. Audit
/// decisions are identical to audit_json; fail/review retain the full report.
#export_name("audit_summary_json")
pub fn audit_summary_json(text : String) -> String {
  audit_json_output(text, summary=true)
}

///|
fn audit_json_output(text : String, summary~ : Bool) -> String {
  if text.length() > 1048576 {
    return error_json("Input exceeds 1048576 UTF-16 code units")
  }
  try {
    let doc = decode_document(text)
    if doc.samples.length() > 200 {
      return error_json("Interactive audit supports at most 200 samples")
    }
    let checked = audit_internal(doc, details=!summary)
    // Unknown/failure still gets the exact complete evidence from the same rules.
    let report = if summary && checked.status != "pass" {
      audit(doc)
    } else {
      checked
    }
    let result : Json = if summary && report.status == "pass" {
      {
        "ok": true,
        "detail_mode": "summary",
        "report": {
          "report_schema": report.report_schema,
          "status": report.status,
          "sample_count": report.sample_count,
          "token_count": report.token_count,
          "error_count": report.error_count,
          "warning_count": report.warning_count,
          "effective_target_count": report.effective_target_count,
        },
      }
    } else {
      { "ok": true, "report": report.to_json() }
    }
    result.stringify()
  } catch {
    error => error_json(error.to_string())
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
pub extend ExpectedSupervision with @json.FromJson::{from_json}

///|
pub extend ExpectedSupervision with ToJson::{to_json}

///|
pub extend ExpectedSupervision with Eq::{not_equal, equal}

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

///|
fn decode_document(text : String) -> Document raise {
  let parsed = @json.parse(text)
  // Accept explicit JSON null for the optional baseline, as well as omission.
  if parsed is Object(fields) {
    if fields.get("boundary_policy") is Some(Null) {
      fields.remove("boundary_policy") |> ignore
    }
    match fields.get("samples") {
      Some(Array(rows)) =>
        for row in rows {
          if row is Object(sample_fields) {
            for key in ["original_supervised_tokens", "expected_supervision"] {
              if sample_fields.get(key) is Some(Null) {
                sample_fields.remove(key) |> ignore
              }
            }
          }
        }
      _ => ()
    }
  }
  @json.from_json(parsed)
}

///|
fn effective_boundary(doc : Document) -> String {
  doc.boundary_policy.unwrap_or("mask-cross-source")
}

///|
fn check_expectation(
  s : Sample,
  allowed : Array[String],
  boundary : String,
  roles : Array[String],
  sources : Array[String],
  findings : Array[Finding],
  details~ : Bool,
) -> (String, String?, Array[Int32]?) {
  guard s.expected_supervision is Some(e) else {
    return ("not-provided", None, None)
  }
  let n = s.input_ids.length()
  if e.schema != "causal-target-mask-v1" ||
    e.source.trim().is_empty() ||
    e.mask.length() != n ||
    s.labels.length() != n ||
    s.attention_mask.length() != n ||
    e.mask.any(fn(x) { x != 0 && x != 1 }) {
    findings.push(
      finding(
        "INVALID_EXPECTED_SUPERVISION",
        "error",
        s.id,
        None,
        "Expected evidence requires causal-target-mask-v1, nonempty source, aligned arrays and a token-length 0/1 mask",
      ),
    )
    return ("invalid", Some(e.source), None)
  }
  let indices : Array[Int32] = []
  let mut conflict = false
  let blocked_starts = Array::make(n, false)
  if boundary == "mask-cross-source" {
    for segment in s.segments {
      if segment.start > 0 &&
        segment.start < n &&
        segment.end > segment.start &&
        segment.end <= n &&
        segment.source_id != "" {
        blocked_starts[segment.start] = true
      }
    }
  }
  for i = 0; i < n; i = i + 1 {
    if e.mask[i] == 0 {
      continue
    }
    if i == 0 ||
      s.attention_mask[i] != 1 ||
      roles[i] == "conflict" ||
      sources[i] == "conflict" ||
      (roles[i] != "unknown" && !allowed.contains(roles[i])) ||
      blocked_starts[i] {
      conflict = true
      findings.push(
        finding(
          "EXPECTED_SUPERVISION_CONFLICT",
          "error",
          s.id,
          Some(i),
          "Expected target conflicts with shift, attention, known provenance or the declared role/boundary policy",
        ),
      )
    }
    if details {
      indices.push(i)
    }
  }
  if conflict {
    return ("invalid", Some(e.source), None)
  }
  let mut mismatch = false
  for i = 1; i < n; i = i + 1 {
    let actual = s.labels[i] != -100
    if e.mask[i] == 1 && !actual {
      mismatch = true
      findings.push(
        finding(
          "EXPECTED_TARGET_MISSING",
          "error",
          s.id,
          Some(i),
          "Caller-provided expected loss target is ignored in labels",
        ),
      )
    } else if e.mask[i] == 0 && actual {
      mismatch = true
      findings.push(
        finding(
          "UNEXPECTED_TARGET",
          "error",
          s.id,
          Some(i),
          "Label contributes to shifted loss outside the caller-provided expected target set",
        ),
      )
    }
  }
  (if mismatch { "mismatch" } else { "matched" }, Some(e.source), Some(indices))
}
