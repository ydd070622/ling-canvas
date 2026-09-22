/**
 * Project document persistence | 项目文档持久化
 *
 * Tauri stores every project as an independent JSON file in the app data
 * directory. Browser development uses the same record model in IndexedDB.
 * Keeping this boundary asynchronous prevents storage details from leaking
 * into the canvas store.
 */

const DB_NAME = 'ling-canvas-projects'
const STORE_NAME = 'projects'

export const isTauriRuntime = () => (
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
)

const invokeTauri = async (command, args = {}) => {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke(command, args)
}

const openBrowserDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1)
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE_NAME)) {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
    }
  }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})

const withBrowserStore = async (mode, operation) => {
  const db = await openBrowserDb()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode)
    const store = transaction.objectStore(STORE_NAME)
    let result
    try {
      result = operation(store)
    } catch (error) {
      db.close()
      reject(error)
      return
    }
    transaction.oncomplete = () => {
      db.close()
      resolve(result?.result)
    }
    transaction.onerror = () => {
      db.close()
      reject(transaction.error)
    }
    transaction.onabort = () => {
      db.close()
      reject(transaction.error || new Error('IndexedDB transaction aborted'))
    }
  })
}

export const loadProjectDocuments = async () => {
  if (isTauriRuntime()) {
    return invokeTauri('load_project_documents')
  }
  return withBrowserStore('readonly', store => store.getAll())
}

export const writeProjectDocument = async (project) => {
  if (isTauriRuntime()) {
    await invokeTauri('write_project_document', { project })
    return
  }
  await withBrowserStore('readwrite', store => store.put(project))
}

export const writeProjectDocuments = async (projects) => {
  if (!projects.length) return
  if (isTauriRuntime()) {
    // Tauri commands write atomically per document. Keeping the calls
    // sequential avoids saturating the WebView IPC channel during migration.
    for (const project of projects) {
      await writeProjectDocument(project)
    }
    return
  }
  await withBrowserStore('readwrite', store => {
    projects.forEach(project => store.put(project))
  })
}

export const deleteProjectDocuments = async (projectIds) => {
  if (!projectIds.length) return
  if (isTauriRuntime()) {
    await invokeTauri('delete_project_documents', { projectIds })
    return
  }
  await withBrowserStore('readwrite', store => {
    projectIds.forEach(projectId => store.delete(projectId))
  })
}
