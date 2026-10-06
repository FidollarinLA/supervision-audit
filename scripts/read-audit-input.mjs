import { createReadStream } from 'node:fs';
import { input_limit_utf16 } from '../web/engine.js';

// This is an engine-input reader, not a general-purpose text-file reader.
// Keep one unit past the MoonBit limit so the core rejects the prefix before
// parsing. Never present an over-limit file as a successfully audited subset.
export async function readAuditStream(stream) {
  const capacity = input_limit_utf16() + 1;
  const chunks = [];
  let length = 0;
  stream.setEncoding('utf8'); // Preserve multi-byte characters across byte chunks.
  for await (const chunk of stream) {
    const kept = chunk.slice(0, capacity - length);
    chunks.push(kept);
    length += kept.length;
    if (length === capacity) break; // Async iteration closes/destroys the stream.
  }
  return chunks.join('');
}

export function readAuditInput(path) {
  return readAuditStream(createReadStream(path, { highWaterMark: 64 * 1024 }));
}
