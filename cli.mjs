import { readFile, writeFile } from 'node:fs/promises';
import { audit_json } from './web/engine.js';
const args = process.argv.slice(2);
if (!args[0] || args.includes('--help')) { console.log('Usage: npm run audit -- FILE.json [--out REPORT.json]'); process.exit(args.includes('--help') ? 0 : 2); }
try {
 const text = await readFile(args[0], 'utf8');
 const result = JSON.parse(audit_json(text));
 const outIndex = args.indexOf('--out');
 const rendered = JSON.stringify(result, null, 2) + '\n';
 if (outIndex >= 0) { if (!args[outIndex + 1]) throw new Error('--out requires a path'); await writeFile(args[outIndex + 1], rendered); }
 else process.stdout.write(rendered);
 process.exitCode = !result.ok ? 2 : result.report.status === 'fail' ? 1 : result.report.status === 'review' ? 3 : 0;
} catch (e) { console.error(e.message); process.exitCode = 2; }
