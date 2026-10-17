///|
/// Policy acts on typed candidate spans, not on roles inferred from token IDs.
pub(all) struct TrainingPolicy {
  train_on_reasoning : Bool
  train_on_final_answers : Bool
  train_on_tools : Bool
  train_on_user : Bool
  train_on_system : Bool
  train_on_tool_responses : Bool
} derive(FromJson, ToJson)

///|
pub(all) struct CandidateSpan {
  start : Int32
  end : Int32
  source_start : Int32
  source_end : Int32
  kind : String
  role : String
} derive(FromJson, ToJson)

///|
pub(all) struct TokenOffset {
  start : Int32
  end : Int32
} derive(FromJson, ToJson)

///|
/// All character positions use UTF-16 code units on every MoonBit backend.
pub(all) struct PreparedRow {
  id : String
  source : String
  text : String
  input_ids : Array[Int32]
  attention_mask : Array[Int32]
  offsets : Array[TokenOffset]
  candidates : Array[CandidateSpan]
} derive(FromJson, ToJson)

///|
priv struct PreparationInput {
  schema : String
  template_family : String
  tokenizer_source : String
  template_source : String
  rows : Array[PreparedRow]
} derive(FromJson)

///|
pub fn default_training_policy() -> TrainingPolicy {
  {
    train_on_reasoning: true,
    train_on_final_answers: true,
    train_on_tools: true,
    train_on_user: false,
    train_on_system: false,
    train_on_tool_responses: false,
  }
}

///|
fn kind_enabled(kind : String, policy : TrainingPolicy) -> Bool {
  match kind {
    "reasoning" => policy.train_on_reasoning
    "final_answer" => policy.train_on_final_answers
    "tool_call" => policy.train_on_tools
    "user" => policy.train_on_user
    "system" => policy.train_on_system
    "tool_response" => policy.train_on_tool_responses
    _ => false
  }
}

///|
fn candidate_role(kind : String) -> String {
  match kind {
    "reasoning" | "final_answer" | "tool_call" => "assistant"
    "user" => "user"
    "system" => "system"
    "tool_response" => "tool"
    _ => ""
  }
}

///|
fn json_field(value : Json, key : String) -> Json? {
  match value {
    Object(fields) => fields.get(key)
    _ => None
  }
}

///|
fn json_text(value : Json, key : String) -> String {
  match json_field(value, key) {
    Some(String(text)) => text
    _ => ""
  }
}

///|
/// Canonical OpenAI-style messages. Tool calls never execute. IDs and source
/// are supplied by the caller; no fabricated provenance or silent row drops.
#export_name("normalize_traces_json")
pub fn normalize_traces_json(text : String) -> String {
  if text.length() > 1048576 {
    return error_json("Raw input exceeds 1048576 UTF-16 code units")
  }
  try {
    let parsed = @json.parse(text)
    guard json_field(parsed, "rows") is Some(Array(rows)) else {
      return error_json(
        "Expected an object with rows: OpenAI messages and tools",
      )
    }
    if rows.is_empty() || rows.length() > 200 {
      return error_json("Preparation requires 1..200 rows")
    }
    let ids : Map[String, Bool] = Map([])
    let normalized : Array[Json] = []
    for row in rows {
      let id = json_text(row, "id")
      let source = json_text(row, "source")
      if id.trim().is_empty() || source.trim().is_empty() || ids.contains(id) {
        return error_json(
          "Every row requires a unique id and an explicit source",
        )
      }
      ids.set(id, true)
      guard json_field(row, "messages") is Some(Array(messages)) else {
        return error_json("Row \{id}: messages must be an array")
      }
      if messages.is_empty() || messages.length() > 200 {
        return error_json("Row \{id}: requires 1..200 messages")
      }
      let tools : Array[Json] = match json_field(row, "tools") {
        None => []
        Some(Array(items)) => items
        _ => return error_json("Row \{id}: tools must be an array")
      }
      let definitions : Map[String, Json] = Map([])
      for tool in tools {
        guard json_field(tool, "function") is Some(function) else {
          return error_json("Row \{id}: tool definition requires function")
        }
        let name = json_text(function, "name")
        if json_text(tool, "type") != "function" ||
          name == "" ||
          definitions.contains(name) {
          return error_json(
            "Row \{id}: invalid or duplicate function definition",
          )
        }
        guard json_field(function, "parameters") is Some(Object(parameters)) else {
          return error_json(
            "Row \{id}: function parameters must be an object schema",
          )
        }
        if parameters.get("type") != Some(Json("object")) {
          return error_json(
            "Row \{id}: only object parameter schemas are supported",
          )
        }
        definitions.set(name, function)
      }
      let pending : Map[String, String] = Map([])
      let call_ids : Map[String, Bool] = Map([])
      let canonical : Array[Json] = []
      for message in messages {
        guard message is Object(message_fields) else {
          return error_json("Row \{id}: every message must be an object")
        }
        for key in message_fields.keys() {
          if ![
              "role", "content", "reasoning_content", "tool_calls", "tool_call_id",
              "name",
            ].contains(key) {
            return error_json(
              "Row \{id}: unsupported message field \{key}; normalize native event formats explicitly",
            )
          }
        }
        let serialized = message.stringify()
        if [
            "<|im_start|>", "<|im_end|>", "<think>", "</think>", "<tool_call>", "</tool_call>",
            "<tool_response>", "</tool_response>",
          ].any(fn(marker) { serialized.contains(marker) }) {
          return error_json(
            "Row \{id}: embedded protocol markers require a separate escaping contract",
          )
        }
        let role = json_text(message, "role")
        if !["system", "user", "assistant", "tool"].contains(role) {
          return error_json(
            "Row \{id}: unsupported role; use system/user/assistant/tool",
          )
        }
        if role != "tool" && pending.length() > 0 {
          return error_json(
            "Row \{id}: all pending tool calls require matching results before the next turn",
          )
        }
        let content : String = match json_field(message, "content") {
          Some(String(value)) => value
          None | Some(Null) => ""
          _ =>
            return error_json(
              "Row \{id}: only text content is supported; multimodal content rejects",
            )
        }
        let fields : Map[String, Json] = {
          "role": Json(role),
          "content": Json(content),
        }
        match json_field(message, "reasoning_content") {
          None | Some(Null) => ()
          Some(String(value)) => {
            if role != "assistant" {
              return error_json(
                "Row \{id}: reasoning_content requires assistant role",
              )
            }
            fields.set("reasoning_content", Json(value))
          }
          _ => return error_json("Row \{id}: reasoning_content must be text")
        }
        match json_field(message, "tool_calls") {
          None | Some(Null) => ()
          Some(Array(calls)) => {
            if role != "assistant" || calls.is_empty() || calls.length() > 32 {
              return error_json(
                "Row \{id}: tool_calls requires an assistant and 1..32 calls",
              )
            }
            let normalized_calls : Array[Json] = []
            for call in calls {
              let call_id = json_text(call, "id")
              guard json_field(call, "function") is Some(function) else {
                return error_json("Row \{id}: call requires function")
              }
              let name = json_text(function, "name")
              guard definitions.get(name) is Some(definition) else {
                return error_json("Row \{id}: called function is not declared")
              }
              if json_text(call, "type") != "function" ||
                call_id == "" ||
                call_ids.contains(call_id) {
                return error_json(
                  "Row \{id}: function calls require unique nonempty IDs",
                )
              }
              let arguments : Json = match json_field(function, "arguments") {
                Some(String(encoded)) => @json.parse(encoded)
                Some(value) => value
                None =>
                  return error_json(
                    "Row \{id}: function arguments are required",
                  )
              }
              guard arguments is Object(argument_fields) else {
                return error_json(
                  "Row \{id}: arguments must decode to an object",
                )
              }
              guard json_field(definition, "parameters") is Some(parameters) else {
                return error_json("Row \{id}: parameters missing")
              }
              match json_field(parameters, "required") {
                None => ()
                Some(Array(required)) =>
                  for key in required {
                    guard key is String(key) else {
                      return error_json(
                        "Row \{id}: required names must be text",
                      )
                    }
                    if !argument_fields.contains(key) {
                      return error_json(
                        "Row \{id}: missing required function argument \{key}",
                      )
                    }
                  }
                _ => return error_json("Row \{id}: required must be an array")
              }
              call_ids.set(call_id, true)
              pending.set(call_id, name)
              normalized_calls.push({
                "id": call_id,
                "type": "function",
                "function": { "name": name, "arguments": arguments },
              })
            }
            fields.set("tool_calls", Json(normalized_calls))
          }
          _ => return error_json("Row \{id}: tool_calls must be an array")
        }
        if role == "tool" {
          let call_id = json_text(message, "tool_call_id")
          guard pending.get(call_id) is Some(name) else {
            return error_json("Row \{id}: orphaned or mismatched tool result")
          }
          if content == "" ||
            (
              json_text(message, "name") != "" &&
              json_text(message, "name") != name
            ) {
            return error_json(
              "Row \{id}: tool result requires content and matching function name",
            )
          }
          pending.remove(call_id) |> ignore
          fields.set("tool_call_id", Json(call_id))
          fields.set("name", Json(name))
        } else if json_field(message, "tool_call_id") is Some(_) {
          return error_json("Row \{id}: tool_call_id requires tool role")
        }
        canonical.push(Json(fields))
      }
      if pending.length() > 0 ||
        json_text(messages[messages.length() - 1], "role") != "assistant" {
        return error_json(
          "Row \{id}: complete training traces must end in an assistant answer",
        )
      }
      normalized.push({
        "id": id,
        "source": source,
        "messages": Json(canonical),
        "tools": Json(tools),
      })
    }
    let result : Json = {
      "ok": true,
      "schema": "normalized-traces-v1",
      "rows": Json(normalized),
    }
    result.stringify()
  } catch {
    error => error_json("Trace normalization failed: \{error.to_string()}")
  }
}

///|
/// Create labels from independently rendered typed spans and tokenizer offsets.
/// Fully-contained offsets only. Missing evidence and unsupported kinds reject.
#export_name("prepare_labels_json")
pub fn prepare_labels_json(text : String, policy_text : String) -> String {
  if text.length() > 4194304 || policy_text.length() > 4096 {
    return error_json("Preparation input/policy exceeds the declared budget")
  }
  try {
    let input : PreparationInput = @json.from_json(@json.parse(text))
    let policy : TrainingPolicy = @json.from_json(@json.parse(policy_text))
    if input.schema != "rendered-traces-utf16-v1" ||
      input.template_family != "chatml-typed-v1" ||
      input.tokenizer_source.trim().is_empty() ||
      input.template_source.trim().is_empty() {
      return error_json(
        "Rendered input requires UTF-16 schema and explicit tokenizer/template sources",
      )
    }
    if input.rows.is_empty() || input.rows.length() > 200 {
      return error_json("Preparation requires 1..200 rows")
    }
    let samples : Array[Sample] = []
    let ids : Map[String, Bool] = Map([])
    let mut token_budget = 0
    let mut character_budget = 0
    let mut interval_budget = 0
    let coverage : Array[Json] = []
    for row in input.rows {
      let n = row.input_ids.length()
      let chars = row.text.length()
      token_budget += n
      character_budget += chars
      if row.id.trim().is_empty() ||
        row.source.trim().is_empty() ||
        ids.contains(row.id) ||
        n == 0 ||
        n > 100000 ||
        token_budget > 100000 ||
        character_budget > 262144 ||
        chars == 0 ||
        chars > 262144 ||
        row.offsets.length() != n ||
        row.attention_mask.length() != n ||
        row.candidates.is_empty() ||
        row.candidates.length() > 2000 {
        return error_json(
          "Row \{row.id}: missing evidence, duplicate ID, misaligned arrays or resource budget exceeded",
        )
      }
      ids.set(row.id, true)
      let selected = Array::make(chars, false)
      let blocked = Array::make(chars, false)
      let char_roles = Array::make(chars, "text")
      for span in row.candidates {
        let role = candidate_role(span.kind)
        if role == "" ||
          role != span.role ||
          span.start < 0 ||
          span.end <= span.start ||
          span.end > chars ||
          span.source_start < span.start ||
          span.source_end > span.end ||
          span.source_end <= span.source_start {
          return error_json(
            "Row \{row.id}: invalid typed candidate span or unsupported kind",
          )
        }
        interval_budget += span.end - span.start
        if interval_budget > 2000000 {
          return error_json(
            "Candidate expansion exceeds 2000000 character visits",
          )
        }
        let enabled = kind_enabled(span.kind, policy)
        for i = span.start; i < span.end; i = i + 1 {
          if char_roles[i] != "text" && char_roles[i] != role {
            return error_json("Row \{row.id}: candidate spans disagree on role")
          }
          char_roles[i] = role
          if enabled {
            selected[i] = true
          }
        }
        if !enabled {
          for i = span.source_start; i < span.source_end; i = i + 1 {
            blocked[i] = true
          }
        }
      }
      // ChatML wrapper exclusions are a declared contract, never guessed from
      // token IDs. Other template families must provide a separate adapter.
      for
        (opening, closing, enabled) in [
          ("<think>", "</think>", policy.train_on_reasoning),
          ("<tool_call>", "</tool_call>", policy.train_on_tools),
          (
            "<tool_response>",
            "</tool_response>",
            policy.train_on_tool_responses,
          ),
        ] {
        if enabled {
          continue
        }
        let mut cursor = 0
        while cursor < chars {
          let tail = row.text[cursor:].to_owned()
          guard tail.find(opening) is Some(left) else { break }
          let start = cursor + left
          guard row.text[start + opening.length():].to_owned().find(closing)
            is Some(right) else {
            return error_json("Row \{row.id}: unclosed typed wrapper")
          }
          let end = start + opening.length() + right + closing.length()
          for i = start; i < end; i = i + 1 {
            blocked[i] = true
          }
          cursor = end
        }
      }
      let labels = Array::make(n, -100)
      let mask = Array::make(n, 0)
      let roles = Array::make(n, "text")
      let mut previous_start = 0
      let mut targets = 0
      for i = 0; i < n; i = i + 1 {
        let offset = row.offsets[i]
        if row.input_ids[i] < 0 ||
          (row.attention_mask[i] != 0 && row.attention_mask[i] != 1) ||
          offset.start < previous_start ||
          offset.start < 0 ||
          offset.end < offset.start ||
          offset.end > chars {
          return error_json(
            "Row \{row.id}: invalid token/attention/offset alignment",
          )
        }
        interval_budget += offset.end - offset.start
        if interval_budget > 2000000 {
          return error_json("Offset expansion exceeds 2000000 character visits")
        }
        previous_start = offset.start
        if offset.end == offset.start || row.attention_mask[i] == 0 {
          continue
        }
        let mut train = true
        let mut role = char_roles[offset.start]
        for j = offset.start; j < offset.end; j = j + 1 {
          if !selected[j] || blocked[j] {
            train = false
          }
          if char_roles[j] != role {
            role = "text"
          }
        }
        roles[i] = role
        if train && i > 0 {
          labels[i] = row.input_ids[i]
          mask[i] = 1
          targets += 1
        }
      }
      if targets == 0 {
        return error_json(
          "Row \{row.id}: selected policy has no effective targets; no row silently drops",
        )
      }
      let spans : Array[Span] = []
      let mut start = 0
      for i = 1; i <= n; i = i + 1 {
        if i == n || roles[i] != roles[start] {
          spans.push({ start, end: i, role: roles[start], })
          start = i
        }
      }
      samples.push({
        id: row.id,
        input_ids: row.input_ids,
        labels,
        attention_mask: row.attention_mask,
        spans,
        segments: [{ start: 0, end: n, source_id: row.source, }],
        original_supervised_tokens: None,
        expected_supervision: Some({
          schema: "causal-target-mask-v1",
          source: "prepared-span-policy-v1:\{input.template_source}",
          mask,
        }),
      })
      coverage.push({
        "id": row.id,
        "source": row.source,
        "candidate_count": row.candidates.length(),
        "effective_targets": targets,
      })
    }
    let allowed_roles : Array[String] = ["assistant"]
    if policy.train_on_user {
      allowed_roles.push("user")
    }
    if policy.train_on_system {
      allowed_roles.push("system")
    }
    if policy.train_on_tool_responses {
      allowed_roles.push("tool")
    }
    let doc : Document = {
      contract: "causal-lm-unshifted-v1",
      allowed_roles,
      boundary_policy: Some("mask-cross-source"),
      samples,
    }
    let report = audit(doc)
    let result : Json = {
      "ok": true,
      "schema": "training-preparation-v1",
      "policy": policy.to_json(),
      "tokenizer_source": input.tokenizer_source,
      "template_source": input.template_source,
      "coverage": Json(coverage),
      "document": doc.to_json(),
      "report": report.to_json(),
      "expectation_basis": "same-preparation-policy; independent Teich comparison is separate",
    }
    result.stringify()
  } catch {
    error => error_json("Label preparation failed: \{error.to_string()}")
  }
}

///|
pub extend TrainingPolicy with @json.FromJson::{from_json}

///|
pub extend TrainingPolicy with ToJson::{to_json}

///|
pub extend CandidateSpan with @json.FromJson::{from_json}

///|
pub extend CandidateSpan with ToJson::{to_json}

///|
pub extend TokenOffset with @json.FromJson::{from_json}

///|
pub extend TokenOffset with ToJson::{to_json}

///|
pub extend PreparedRow with @json.FromJson::{from_json}

///|
pub extend PreparedRow with ToJson::{to_json}
