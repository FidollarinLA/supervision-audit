import {audit_json,compare_json} from './web/preparation-engine.js';
import {readInputFile,writeProtectedReport} from './scripts/input-file.mjs';
import {reportSummary} from './web/report-summary.js';
const args=process.argv.slice(2);
if(!args.length||args.includes('--help')){console.log('Usage: node prepared-audit.mjs DOCUMENT.json [--baseline BEFORE.json] [--out REPORT.json] [--quiet]');process.exit(args.includes('--help')?0:2);}
try{const options=new Map();for(let i=1;i<args.length;i++){const key=args[i];if(!['--baseline','--out','--quiet'].includes(key)||options.has(key))throw Error('Unknown or duplicate option: '+key);if(key==='--quiet')options.set(key,true);else{const value=args[++i];if(!value||value.startsWith('--'))throw Error(key+' requires a value');options.set(key,value);}}
const input=await readInputFile(args[0]),baseline=options.has('--baseline')?await readInputFile(options.get('--baseline')):null;
const result=JSON.parse(baseline?compare_json(baseline.text,input.text):audit_json(input.text));const output=JSON.stringify(result,null,2)+'\n';
if(options.has('--out'))await writeProtectedReport(options.get('--out'),output,[input,...(baseline?[baseline]:[])]);else process.stdout.write(output);
if(!options.has('--quiet'))console.error(reportSummary(result));process.exitCode=!result.ok?2:result.comparison?0:result.report.status==='fail'?1:result.report.status==='review'?3:0;
}catch(error){console.error(error.message);process.exitCode=2;}
