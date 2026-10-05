import { parentPort } from 'node:worker_threads';
// Browser Worker event shell; execute the real browser entry and MoonBit engine.
globalThis.self = { postMessage: data => parentPort.postMessage(data) };
await import('../../web/engine-worker.js');
parentPort.on('message', data => self.onmessage({ data }));
