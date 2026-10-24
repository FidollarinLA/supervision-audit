///|
/// Token-count limits are applied to fully validated, unshifted labels.
/// `truncate-right` keeps a token prefix and may cut inside a message.
/// `truncate-complete-turns` keeps the longest prefix that ends on a
/// complete answer turn (assistant/text span end), similar in intent to
/// Teich `oversized_policy="trim_followups"`, without retokenizing.
pub(all) struct SequenceLimits {
  max_length : Int32
  overflow : String
} derive(FromJson, ToJson)

///|
fn overflow_allowed(overflow : String) -> Bool {
  overflow == "reject" ||
  overflow == "truncate-right" ||
  overflow == "truncate-complete-turns"
}

///|
fn target_count(labels : Array[Int32], start : Int32, end : Int32) -> Int32 {
  let mut count = 0
  for i = start; i < end; i = i + 1 {
    if labels[i] != -100 {
      count += 1
    }
  }
  count
}

///|
/// Prefer the longest prefix ending at an assistant/text span boundary.
/// User/system/tool-only prefixes are not accepted as complete training turns.
fn complete_turn_kept(sample : Sample, max_length : Int32) -> Int32? {
  let n = sample.input_ids.length()
  if n <= max_length {
    return Some(n)
  }
  let mut kept : Int32 = 0
  for span in sample.spans {
    if span.end > max_length {
      break
    }
    // Cut only after a supervised answer/text span itself, not after a
    // following context span that merely inherits earlier targets.
    let span_targets = target_count(
      sample.labels,
      if span.start > 1 {
        span.start
      } else {
        1
      },
      span.end,
    )
    if (span.role == "assistant" || span.role == "text") && span_targets > 0 {
      kept = span.end
    }
  }
  if kept >= 2 {
    Some(kept)
  } else {
    None
  }
}

///|
fn choose_kept(
  sample : Sample,
  limits : SequenceLimits,
) -> Result[Int32, String] {
  let n = sample.input_ids.length()
  if n <= limits.max_length {
    return Ok(n)
  }
  match limits.overflow {
    "reject" =>
      Err(
        "Row \{sample.id}: \{n} tokens exceed max_length \{limits.max_length}; select truncate-right or truncate-complete-turns explicitly",
      )
    "truncate-right" => Ok(limits.max_length)
    "truncate-complete-turns" =>
      match complete_turn_kept(sample, limits.max_length) {
        Some(kept) => Ok(kept)
        None =>
          Err(
            "Row \{sample.id}: no complete assistant/text turn fits within max_length \{limits.max_length}; refusing mid-turn truncation",
          )
      }
    _ => Err("Unsupported overflow policy")
  }
}

///|
fn boundary_note(overflow : String) -> String {
  match overflow {
    "truncate-complete-turns" =>
      "complete-turn prefix ending on assistant/text span; later follow-up turns may be removed"
    _ =>
      "right token prefix; complete messages and tool calls are not guaranteed"
  }
}

///|
fn expectation_suffix(overflow : String, max_length : Int32) -> String {
  match overflow {
    "truncate-complete-turns" => ":complete-turn-max=\{max_length}"
    _ => ":right-prefix-max=\{max_length}"
  }
}

///|
/// Prepare a batch atomically, then enforce an explicit sequence-length policy.
/// No retokenization, silent dropping, left truncation or implicit truncation.
#export_name("prepare_training_json")
pub fn prepare_training_json(
  text : String,
  policy_text : String,
  limits_text : String,
) -> String {
  if limits_text.length() > 4096 {
    return error_json("Sequence limits exceed 4096 UTF-16 code units")
  }
  try {
    let limits_json = @json.parse(limits_text)
    guard limits_json is Object(limit_fields) else {
      return error_json("Sequence limits require max_length and overflow")
    }
    for key in limit_fields.keys() {
      if key != "max_length" && key != "overflow" {
        return error_json("Unknown sequence limit: \{key}")
      }
    }
    let limits : SequenceLimits = @json.from_json(limits_json)
    if limits.max_length < 2 ||
      limits.max_length > 100000 ||
      !overflow_allowed(limits.overflow) {
      return error_json(
        "Sequence max_length must be 2..100000; overflow must be reject, truncate-right or truncate-complete-turns",
      )
    }
    // Validate the complete input before considering any discardable suffix.
    let prepared = prepare_labels_json(text, policy_text)
    guard @json.parse(prepared) is Object(fields) &&
      fields.get("ok") is Some(True) else {
      return prepared
    }
    guard fields.get("document") is Some(doc_json) else {
      return error_json("Prepared document missing")
    }
    let original : Document = @json.from_json(doc_json)
    let samples : Array[Sample] = []
    let summaries : Array[Json] = []
    let mut removed_tokens = 0
    let mut removed_targets = 0
    let mut truncated_samples = 0
    for sample in original.samples {
      let n = sample.input_ids.length()
      let kept = match choose_kept(sample, limits) {
        Ok(value) => value
        Err(message) => return error_json(message)
      }
      let original_targets = target_count(sample.labels, 1, n)
      let kept_targets = target_count(sample.labels, 1, kept)
      if kept_targets == 0 {
        return error_json(
          "Row \{sample.id}: sequence prefix has no effective targets after length control; entire batch rejected",
        )
      }
      guard sample.expected_supervision is Some(expected) else {
        return error_json("Prepared expectation missing")
      }
      let spans : Array[Span] = []
      for span in sample.spans {
        if span.start < kept {
          spans.push({
            start: span.start,
            end: if span.end > kept {
              kept
            } else {
              span.end
            },
            role: span.role,
          })
        }
      }
      let segments : Array[Segment] = []
      for segment in sample.segments {
        if segment.start < kept {
          segments.push({
            start: segment.start,
            end: if segment.end > kept {
              kept
            } else {
              segment.end
            },
            source_id: segment.source_id,
          })
        }
      }
      samples.push({
        id: sample.id,
        input_ids: Array::makei(kept, i => sample.input_ids[i]),
        labels: Array::makei(kept, i => sample.labels[i]),
        attention_mask: Array::makei(kept, i => sample.attention_mask[i]),
        spans,
        segments,
        original_supervised_tokens: None,
        expected_supervision: Some({
          schema: expected.schema,
          source: if kept < n {
            "\{expected.source}\{expectation_suffix(limits.overflow, limits.max_length)}"
          } else {
            expected.source
          },
          mask: Array::makei(kept, i => expected.mask[i]),
        }),
      })
      if kept < n {
        truncated_samples += 1
      }
      removed_tokens += n - kept
      removed_targets += original_targets - kept_targets
      summaries.push({
        "id": sample.id,
        "original_tokens": n,
        "kept_tokens": kept,
        "removed_tokens": n - kept,
        "original_targets": original_targets,
        "kept_targets": kept_targets,
        "removed_targets": original_targets - kept_targets,
        "cut_policy": limits.overflow,
      })
    }
    let doc : Document = {
      contract: original.contract,
      allowed_roles: original.allowed_roles,
      boundary_policy: original.boundary_policy,
      samples,
    }
    let report = audit(doc)
    fields.set("document", doc.to_json())
    fields.set("report", report.to_json())
    fields.set("sequence_limits", limits.to_json())
    fields.set("sequence_summary", {
      "truncated_samples": truncated_samples,
      "removed_tokens": removed_tokens,
      "removed_targets": removed_targets,
      "samples": Json(summaries),
      "boundary": boundary_note(limits.overflow),
    })
    // Coverage continues to describe the released labels, not the full input.
    match fields.get("coverage") {
      Some(Array(rows)) =>
        for i = 0; i < rows.length(); i = i + 1 {
          if rows[i] is Object(row) && summaries[i] is Object(summary) {
            if summary.get("kept_targets") is Some(targets) {
              row.set("effective_targets", targets)
            }
          }
        }
      _ => ()
    }
    Json(fields).stringify()
  } catch {
    error => error_json("Sequence preparation failed: \{error.to_string()}")
  }
}

///|
pub extend SequenceLimits with @json.FromJson::{from_json}

///|
pub extend SequenceLimits with ToJson::{to_json}
