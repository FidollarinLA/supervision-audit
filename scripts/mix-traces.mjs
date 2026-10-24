#!/usr/bin/env node
/**
 * Deterministic multi-source row mixer for preparation inputs.
 * Mixes already-normalized or rendered trace files by explicit counts.
 * Does not generate agent data, download Hub datasets, or call Teich.
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

function usage(code = 2) {
  console.log(`Usage: node scripts/mix-traces.mjs MIX.json [--out FILE]

MIX.json example:
{
  "schema": "supervision-audit/mix-v1",
  "output_schema": "normalized-traces-v1",
  "seed": 1,
  "sources": [
    {"path": "a.json", "take": 1, "id_prefix": "chat-"},
    {"path": "b.json", "take": 2, "id_prefix": "tool-"}
  ]
}

Each source file must already be {"rows":[...]} (normalized or rendered).
Rows are taken in file order up to "take". IDs are prefixed to avoid collisions.
For rendered mixes, every source must share template_family / tokenizer_source / template_source.
This is a local composition helper, not a Hub mixer or agent generator.`);
  process.exit(code);
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, rand) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) usage(args.includes('--help') ? 0 : 2);

try {
  let outPath;
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') {
      outPath = args[++i];
      if (!outPath || outPath.startsWith('--')) throw Error('--out requires a path');
    } else if (args[i].startsWith('--')) {
      throw Error('Unknown option: ' + args[i]);
    } else {
      positional.push(args[i]);
    }
  }
  if (positional.length !== 1) throw Error('Provide exactly one MIX.json');
  const mix = JSON.parse(readFileSync(resolve(positional[0]), 'utf8'));
  if (mix.schema !== 'supervision-audit/mix-v1') throw Error('schema must be supervision-audit/mix-v1');
  if (!Array.isArray(mix.sources) || mix.sources.length < 1 || mix.sources.length > 32) {
    throw Error('sources must contain 1..32 entries');
  }
  const outputSchema = mix.output_schema || 'normalized-traces-v1';
  if (!['normalized-traces-v1', 'rendered-traces-utf16-v1'].includes(outputSchema)) {
    throw Error('output_schema must be normalized-traces-v1 or rendered-traces-utf16-v1');
  }
  const seed = Number.isInteger(mix.seed) ? mix.seed : 1;
  const rows = [];
  const seen = new Set();
  let templateMeta = null;
  for (const source of mix.sources) {
    if (!source || typeof source.path !== 'string') throw Error('each source requires path');
    const take = source.take;
    if (!Number.isInteger(take) || take < 1 || take > 200) throw Error('take must be 1..200');
    const prefix = source.id_prefix || '';
    if (typeof prefix !== 'string' || prefix.length > 64) throw Error('id_prefix must be text ≤64');
    const file = JSON.parse(readFileSync(resolve(source.path), 'utf8'));
    if (!Array.isArray(file.rows)) throw Error(`${source.path} must contain rows[]`);
    if (file.rows.length < take) throw Error(`${source.path} has ${file.rows.length} rows; need ${take}`);
    if (outputSchema === 'rendered-traces-utf16-v1') {
      const meta = {
        template_family: file.template_family,
        tokenizer_source: file.tokenizer_source,
        template_source: file.template_source,
      };
      if (!meta.template_family || !meta.tokenizer_source || !meta.template_source) {
        throw Error(`${source.path} lacks rendered template metadata`);
      }
      if (!templateMeta) templateMeta = meta;
      else if (JSON.stringify(templateMeta) !== JSON.stringify(meta)) {
        throw Error('rendered sources must share template_family/tokenizer_source/template_source');
      }
    }
    for (let i = 0; i < take; i++) {
      const row = structuredClone(file.rows[i]);
      if (!row || typeof row.id !== 'string') throw Error(`${source.path} row ${i} lacks id`);
      row.id = prefix + row.id;
      if (seen.has(row.id)) throw Error(`duplicate id after prefixing: ${row.id}`);
      seen.add(row.id);
      rows.push(row);
    }
  }
  const ordered = shuffle(rows, mulberry32(seed));
  const output = {
    schema: outputSchema,
    seed,
    rows: ordered,
    mix: {
      source_count: mix.sources.length,
      row_count: ordered.length,
      note: 'Deterministic local mix; ratios are explicit take counts, not Hub sampling.',
    },
  };
  if (templateMeta) Object.assign(output, templateMeta);
  const text = JSON.stringify(output, null, 2) + '\n';
  if (outPath) writeFileSync(resolve(outPath), text);
  else process.stdout.write(text);
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
