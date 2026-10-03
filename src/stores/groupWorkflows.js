import { ref } from 'vue'
import { idbGet, idbPut } from './idb'
export const groupWorkflows = ref([])
let ready
export const loadGroupWorkflows = () => ready ||= idbGet('ling-group-workflows', 'templates', 'all').then(items => { groupWorkflows.value = items || [] }).catch(error => { ready = null; throw error })
export const saveGroupWorkflow = async (workflow) => {
  await loadGroupWorkflows()
  const next = [...groupWorkflows.value, workflow]
  await idbPut('ling-group-workflows', 'templates', 'all', JSON.parse(JSON.stringify(next)))
  groupWorkflows.value = next
}
