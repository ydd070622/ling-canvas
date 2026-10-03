const openDB = () => new Promise((resolve,reject) => {
  const request = indexedDB.open('ling-canvas-agent-history',1)
  request.onupgradeneeded = () => request.result.createObjectStore('history')
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})
export const loadAgentHistory = async () => {
  const db = await openDB()
  return new Promise((resolve,reject) => {
    const tx = db.transaction('history','readonly'), request=tx.objectStore('history').get('conversations')
    request.onsuccess=() => resolve(request.result); request.onerror=() => reject(request.error)
    tx.oncomplete=() => db.close()
  })
}
export const saveAgentHistory = async state => {
  const db = await openDB()
  return new Promise((resolve,reject) => {
    const tx=db.transaction('history','readwrite'); tx.objectStore('history').put(state,'conversations')
    tx.oncomplete=() => { db.close(); resolve() }; tx.onerror=() => { db.close(); reject(tx.error) }
  })
}
