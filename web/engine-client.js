// Each request owns a worker. Cancellation terminates synchronous MoonBit work,
// rather than queuing a cancellation message behind that work.
function browserWorker() {
  if (typeof Worker === 'undefined') throw new Error('浏览器不支持后台审计，请使用支持模块 Worker 的浏览器或 CLI');
  return new Worker(new URL('./engine-worker.js', import.meta.url), { type: 'module' });
}

export function createEngineClient(createWorker = browserWorker) {
  let active = null;
  const cancel = () => {
    if (active) active.finish(Object.assign(new Error('计算已取消'), { name: 'AbortError' }));
  };
  return {
    cancel,
    run(request) {
      cancel();
      return new Promise((resolve, reject) => {
        const job = { worker: null, finish: null };
        job.finish = (error, result) => {
          if (active !== job) return;
          active = null;
          job.worker?.terminate();
          if (error) reject(error); else resolve(result);
        };
        active = job;
        try {
          job.worker = createWorker();
          job.worker.onmessage = ({ data }) => {
            if (data?.error) job.finish(new Error(data.error));
            else if (data && Object.hasOwn(data, 'result')) job.finish(null, data.result);
            else job.finish(new Error('后台返回了无法识别的消息'));
          };
          job.worker.onerror = event => {
            event.preventDefault?.();
            job.finish(new Error(event.message || '后台审计无法启动，请使用支持模块 Worker 的浏览器或 CLI'));
          };
          job.worker.onmessageerror = () => job.finish(new Error('无法读取后台计算结果'));
          job.worker.postMessage(request);
        } catch (error) { job.finish(error); }
      });
    },
  };
}
