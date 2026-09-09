/**
 * Canonical canvas document contracts (JSDoc).
 * Runtime defaults and connection capabilities live in config/nodeRegistry.js.
 */

/** @typedef {'idle'|'loading'|'success'|'error'} NodeStatus */
/** @typedef {'text'|'image'|'video'|'group'} NodeType */

/**
 * @typedef {Object} BaseNodeData
 * @property {string} label
 * @property {NodeStatus} [status]
 * @property {string} [error]
 * @property {boolean} [expanded]
 * @property {number} createdAt
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} CanvasNode
 * @property {string} id
 * @property {NodeType} type
 * @property {{x:number,y:number}} position
 * @property {BaseNodeData & Record<string, unknown>} data
 * @property {number} [zIndex]
 */

/**
 * @typedef {Object} CanvasEdge
 * @property {string} id
 * @property {string} source
 * @property {string} target
 * @property {string} sourceHandle
 * @property {string} targetHandle
 * @property {'flowEdge'} type
 * @property {{label:string,color:string,order:number}} data
 */

/**
 * @typedef {Object} CanvasDocument
 * @property {2} schemaVersion
 * @property {CanvasNode[]} nodes
 * @property {CanvasEdge[]} edges
 * @property {{x:number,y:number,zoom:number}} viewport
 */

export { CANVAS_NODE_TYPES, CONTENT_NODE_TYPES, NODE_DEFINITIONS, createDefaultNodeData } from '../config/nodeRegistry'

