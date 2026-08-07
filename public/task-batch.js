export function isTaskCanceledError(error) {
  return Boolean(error?.canceled || error?.name === "AbortError" || Number(error?.status || 0) === 499);
}

export async function runSettledTaskBatch(items, limit, worker, { signal } = {}) {
  const list = Array.from(items || []);
  const results = new Array(list.length);
  let nextIndex = 0;

  const runNext = async () => {
    while (nextIndex < list.length && !signal?.aborted) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { status: "success", value: await worker(list[index], index, signal) };
      } catch (error) {
        results[index] = isTaskCanceledError(error)
          ? { status: "canceled", reason: error }
          : { status: "failed", reason: error };
      }
    }
  };

  const workerCount = Math.max(1, Math.min(Number(limit) || 1, list.length || 1));
  await Promise.all(Array.from({ length: workerCount }, runNext));
  for (let index = 0; index < results.length; index += 1) {
    if (!results[index]) results[index] = { status: "canceled", reason: null };
  }
  return results;
}

export function summarizeTaskBatch(results = []) {
  return results.reduce((summary, result) => {
    const status = result?.status === "success" || result?.status === "failed" ? result.status : "canceled";
    summary[status] += 1;
    return summary;
  }, { success: 0, failed: 0, canceled: 0 });
}
