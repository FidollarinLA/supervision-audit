// Transport only. Preparation, labels and audit decisions are MoonBit exports.
import {normalize_traces_json,prepare_labels_json,audit_json} from '../../web/preparation-engine.js';
let text='';for await (const chunk of process.stdin) text+=chunk;
const {op,value,policy}=JSON.parse(text);
const output=op==='normalize'?normalize_traces_json(JSON.stringify(value)):
  op==='prepare'?prepare_labels_json(JSON.stringify(value),JSON.stringify(policy)):
  op==='audit'?audit_json(JSON.stringify(value)):JSON.stringify({ok:false,error:'Unknown operation'});
process.stdout.write(output+'\n');
