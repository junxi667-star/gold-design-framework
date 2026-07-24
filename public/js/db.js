const DATABASE_NAME = "gold-design-framework";
const DATABASE_VERSION = 2;
const STORES = [
  "projects",
  "knowledge",
  "assets",
  "aiRequirements",
  "aiTasks",
  "aiResults",
  "aiFeedback",
  "promptTemplates",
];

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error ?? new Error("本地数据库操作失败")));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", resolve);
    transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("本地数据库事务已中止")));
    transaction.addEventListener("error", () => reject(transaction.error ?? new Error("本地数据库事务失败")));
  });
}

export class LocalDatabase {
  constructor(indexedDb = globalThis.indexedDB) {
    if (!indexedDb) {
      throw new Error("当前浏览器不支持 IndexedDB，无法保存本地项目");
    }
    this.indexedDb = indexedDb;
    this.databasePromise = null;
  }

  open() {
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        const request = this.indexedDb.open(DATABASE_NAME, DATABASE_VERSION);
        request.addEventListener("upgradeneeded", () => {
          for (const store of STORES) {
            if (!request.result.objectStoreNames.contains(store)) {
              request.result.createObjectStore(store, { keyPath: "id" });
            }
          }
        });
        request.addEventListener("success", () => resolve(request.result));
        request.addEventListener("error", () => reject(request.error ?? new Error("无法打开本地数据库")));
      });
    }
    return this.databasePromise;
  }

  async getAll(storeName) {
    const database = await this.open();
    const transaction = database.transaction(storeName, "readonly");
    return requestResult(transaction.objectStore(storeName).getAll());
  }

  async get(storeName, recordId) {
    const database = await this.open();
    const transaction = database.transaction(storeName, "readonly");
    return requestResult(transaction.objectStore(storeName).get(recordId));
  }

  async put(storeName, value) {
    const database = await this.open();
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value);
    await transactionDone(transaction);
    return value;
  }

  async delete(storeName, recordId) {
    const database = await this.open();
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(recordId);
    await transactionDone(transaction);
  }

  async clearAll() {
    const database = await this.open();
    const transaction = database.transaction(STORES, "readwrite");
    for (const store of STORES) {
      transaction.objectStore(store).clear();
    }
    await transactionDone(transaction);
  }
}
