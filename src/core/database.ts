// A blocked request can still succeed later. Close that abandoned connection so
// it cannot block a subsequent retry or leak an unused database handle.
export function createDatabaseOpener(open: () => IDBOpenDBRequest, invalidate: () => void = () => {}) {
  let cached: Promise<IDBDatabase> | undefined;
  return function database(): Promise<IDBDatabase> {
    if (cached) return cached;
    const attempt = new Promise<IDBDatabase>((resolve, reject) => {
      const request = open();
      let abandoned = false;
      const fail = (error: unknown) => { abandoned = true; reject(error); };
      request.onerror = () => fail(request.error);
      request.onblocked = () => fail(new Error('请关闭其他页间窗口后重试，以完成本机书架升级'));
      request.onsuccess = () => {
        const connection = request.result;
        if (abandoned) { connection.close(); return; }
        const reset = () => { if (cached === attempt) { cached = undefined; invalidate(); } };
        connection.onversionchange = () => { connection.close(); reset(); };
        connection.onclose = reset;
        resolve(connection);
      };
    });
    cached = attempt;
    attempt.catch(() => { if (cached === attempt) { cached = undefined; invalidate(); } });
    return attempt;
  };
}
