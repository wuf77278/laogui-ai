const DB_NAME = "laogui-deep-edit";
const STORE_NAME = "layer-projects";
const DB_VERSION = 1;

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error("当前环境不支持工程存储"));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("工程存储打开失败"));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("工程存储操作失败"));
  });
}

export async function loadLayerProject(key) {
  const db = await openDatabase();
  try {
    return await requestResult(db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key));
  } finally {
    db.close();
  }
}

export async function saveLayerProject(project) {
  const db = await openDatabase();
  try {
    await requestResult(db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put({ ...project, updatedAt: Date.now() }));
  } finally {
    db.close();
  }
}
