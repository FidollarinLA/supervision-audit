import { executeEngineJob } from './engine-job.js';

self.onmessage = ({ data }) => {
  try { self.postMessage({ result: executeEngineJob(data) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
