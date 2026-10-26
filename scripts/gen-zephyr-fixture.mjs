import { writeFileSync } from 'node:fs';

const text =
  '<|system|>\nYou are helpful.</s>\n<|user|>\nWhat is 2+2?</s>\n<|assistant|>\n4</s>\n';
const offsets = [];
let i = 0;
for (const ch of text) {
  const len = ch.length;
  offsets.push({ start: i, end: i + len });
  i += len;
}
const input_ids = offsets.map((_, idx) => 100 + idx);
const attention_mask = input_ids.map(() => 1);

function span(substr, kind, role) {
  const start = text.indexOf(substr);
  if (start < 0) throw new Error('missing ' + substr);
  const end = start + [...substr].reduce((n, c) => n + c.length, 0);
  const fully = offsets
    .map((o, idx) => ({ o, idx }))
    .filter(({ o }) => o.start >= start && o.end <= end);
  if (!fully.length) throw new Error('no tokens for ' + substr);
  return {
    start: fully[0].idx,
    end: fully[fully.length - 1].idx + 1,
    source_start: start,
    source_end: end,
    kind,
    role,
  };
}

const out = {
  schema: 'rendered-traces-utf16-v1',
  template_family: 'zephyr-typed-v1',
  tokenizer_source: 'project-authored-wordlevel-zephyr-demo',
  template_source: 'project-authored-zephyr-style-chat-template',
  rows: [
    {
      id: 'zephyr-demo',
      source: 'project-authored-apache-2.0:zephyr-style-demo',
      text,
      input_ids,
      attention_mask,
      offsets,
      candidates: [
        span('You are helpful.', 'system', 'system'),
        span('What is 2+2?', 'user', 'user'),
        span('4', 'final_answer', 'assistant'),
      ],
    },
  ],
};

writeFileSync(
  new URL('../examples/traces/zephyr-rendered.json', import.meta.url),
  JSON.stringify(out, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    tokens: input_ids.length,
    textLen: text.length,
    candidates: out.rows[0].candidates,
  }),
);
