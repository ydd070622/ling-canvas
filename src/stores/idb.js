/**
 * 通用 IndexedDB 样板 | Generic IndexedDB helpers
 *
 * 只给新的 store 用。`stores/imageStore.js` 的库版本号与升级分支已经被
 * 现有的持久化链路和测试覆盖，不在本次改动范围内。
 */

export const openIdb = (dbName, storeName) => new Promise((resolve, reject) => {
  const request = indexedDB.open(dbName, 1)
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(storeName)) {
      request.result.createObjectStore(storeName)
    }
  }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})

export const idbGet = async (dbName, storeName, key) => {
  const db = await openIdb(dbName, storeName)
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key)
    request.onsuccess = () => resolve(request.result ?? null)
    request.onerror = () => reject(request.error)
  })
}

export const idbPut = async (dbName, storeName, key, value) => {
  const db = await openIdb(dbName, storeName)
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export const idbClear = async (dbName, storeName) => {
  const db = await openIdb(dbName, storeName)
  return new Promise((resolve, reject) => {
    // 必须用 objectStore.clear()，不能用 indexedDB.deleteDatabase：
    // openIdb 的连接从不 close，deleteDatabase 会被一直阻塞。
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
