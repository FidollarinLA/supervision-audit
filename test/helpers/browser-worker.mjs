import { Worker } from 'node:worker_threads';

export class BrowserWorker {
  constructor() {
    this.worker = new Worker(new URL('./engine-worker-thread.mjs', import.meta.url));
    this.worker.on('message', data => this.onmessage?.({ data }));
    this.worker.on('error', error => this.onerror?.({ message: error.message, preventDefault() {} }));
    this.worker.on('messageerror', () => this.onmessageerror?.());
  }
  postMessage(data) { this.worker.postMessage(data); }
  terminate() { this.worker.terminate(); }
}
