// One disposable worker per request; termination interrupts synchronous MoonBit.
export class AuditRunner {
  constructor(createWorker = () => new Worker(new URL('./preparation-worker.js', import.meta.url), { type: 'module' })) {
    this.createWorker = createWorker;
    this.active = null;
    this.sequence = 0;
  }
  cancel() {
    const job = this.active;
    if (!job) return;
    this.active = null;
    job.worker.terminate();
    const error = new Error('审计已取消'); error.name = 'AbortError';
    job.reject(error);
  }
  run(request, onProgress = () => {}) {
    this.cancel();
    return new Promise((resolve, reject) => {
      const worker = this.createWorker();
      const job = { worker, reject, id: ++this.sequence };
      this.active = job;
      const finish = (error, payload) => {
        if (this.active !== job) return;
        this.active = null; worker.terminate();
        if (error) reject(error); else resolve(payload);
      };
      worker.onmessage = ({ data }) => {
        if (this.active !== job || data.id !== job.id) return;
        if (data.phase) onProgress(data.phase);
        else finish(data.error ? new Error(data.error) : null, data.payload);
      };
      worker.onerror = event => { event.preventDefault?.(); finish(new Error(event.message || '后台审计无法启动，请重新加载页面后重试。')); };
      worker.onmessageerror = () => finish(new Error('后台结果无法读取，请重新运行审计。'));
      try { worker.postMessage({ id: job.id, request }); }
      catch (error) { finish(error); }
    });
  }
}
