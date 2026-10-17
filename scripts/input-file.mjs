// File transport only. MoonBit retains its independent UTF-16/core limits.
import {open, stat} from 'node:fs/promises';
import {resolve} from 'node:path';

export const MAX_INPUT_BYTES = 4 * 1048576;
const comparable = path => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
function checkInput(info) {
  if (!info.isFile()) throw Error('Input must be a regular file');
  if (info.size > BigInt(MAX_INPUT_BYTES)) throw Error('Input exceeds raw byte limit (4 MiB)');
}
function sameFile(first, second) {
  return first.dev === second.dev && first.ino === second.ino;
}

export async function readInputFile(path) {
  // Reject directories/devices before opening; repeat against the actual FD.
  const before = await stat(path, {bigint: true});
  checkInput(before);
  const file = await open(path, 'r');
  try {
    const identity = await file.stat({bigint: true});
    checkInput(identity);
    if (!sameFile(before, identity)) throw Error('Input changed before it could be opened');
    // Preserve a BOM for the core parser; reject invalid bytes rather than
    // silently replacing a source ID or any other JSON content.
    const decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
    const buffer = Buffer.alloc(65536), parts = [];
    let bytes = 0;
    for (;;) {
      // At the limit, a one-byte probe detects growth without reading its tail.
      const length = Math.min(buffer.length, MAX_INPUT_BYTES - bytes + 1);
      const {bytesRead} = await file.read(buffer, 0, length, null);
      if (!bytesRead) break;
      bytes += bytesRead;
      if (bytes > MAX_INPUT_BYTES) throw Error('Input exceeds raw byte limit (4 MiB)');
      parts.push(decoder.decode(buffer.subarray(0, bytesRead), {stream: true}));
    }
    parts.push(decoder.decode());
    const after = await file.stat({bigint: true});
    if (after.size !== BigInt(bytes) || after.size !== identity.size || after.mtimeNs !== identity.mtimeNs) {
      throw Error('Input changed while it was being read');
    }
    return {text: parts.join(''), path, identity};
  } finally {
    await file.close();
  }
}

export async function writeProtectedReport(path, rendered, inputs) {
  if (inputs.some(input => comparable(path) === comparable(input.path))) {
    throw Error('Output must not overwrite an input or baseline file');
  }
  let file;
  try {
    // Existing reports may be replaced, but opening must not truncate first.
    // A missing target uses exclusive creation; an intervening file fails.
    try { file = await open(path, 'r+'); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      file = await open(path, 'wx');
    }
    const identity = await file.stat({bigint: true});
    if (!identity.isFile()) throw Error('Output must be a regular file');
    if (!identity.ino || inputs.some(input => !input.identity.ino)) {
      throw Error('Cannot verify output file identity on this filesystem');
    }
    if (inputs.some(input => sameFile(identity, input.identity))) {
      throw Error('Output must not overwrite an alias of an input or baseline file');
    }
    const bytes = Buffer.from(rendered, 'utf8');
    await file.writeFile(bytes);
    await file.truncate(bytes.length);
  } finally {
    await file?.close();
  }
}
