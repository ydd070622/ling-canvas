/**
 * useNodeActions - Node operation composable
 * 节点操作 Hook
 * 
 * Provides common node operations: duplicate, delete, update
 * 提供常用节点操作：复制、删除、更新
 */
import { updateNode, removeNode, duplicateNode } from '../stores/canvas'
import { useVueFlow } from '@vue-flow/core'

export function useNodeActions(nodeId) {
  const { updateNodeInternals } = useVueFlow()

  /**
   * Duplicate current node | 复制当前节点
   * @returns {string|null} New node ID or null if failed
   */
  const duplicate = () => {
    const newNodeId = duplicateNode(nodeId)
    if (newNodeId) {
      setTimeout(() => updateNodeInternals(newNodeId), 50)
      window.$message?.success('节点已复制')
    }
    return newNodeId
  }

  /**
   * Delete current node | 删除当前节点
   */
  const remove = () => {
    removeNode(nodeId)
    window.$message?.success('节点已删除')
  }

  /**
   * Update node data | 更新节点数据
   * @param {Object} data - Data to update
   */
  const update = (data) => {
    updateNode(nodeId, data)
  }

  return {
    duplicate,
    remove,
    update
  }
}
