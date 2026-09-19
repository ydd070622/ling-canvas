/**
 * 节点图标 | Node icons
 *
 * 线性图标，创建菜单和"缩小时的节点角标"共用同一套 —— 同一件事在两处长得不一样
 * 会让人以为是两种东西。
 */

const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

export const NODE_ICONS = Object.freeze({
  text: svg('<path d="M4 6h16M4 12h16M4 18h10"/>'),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M21 16.5l-4.3-4.3a1.6 1.6 0 0 0-2.3 0L6 20.5"/>'),
  video: svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M10.5 9.5v5l4.2-2.5z" fill="currentColor" stroke="none"/>'),
  audio: svg('<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>'),
  task: svg('<path d="M12 3l1.7 5 5 1.7-5 1.7L12 16.4l-1.7-5-5-1.7 5-1.7z"/>'),
  render: svg('<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>'),
  compare: svg('<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M12 4.5v15" stroke-dasharray="2.5 2.5"/><path d="M8.5 12 6 9.5 8.5 7M15.5 7 18 9.5 15.5 12"/>')
})

export const ACTION_ICONS = Object.freeze({
  upload: svg('<path d="M12 16V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/>'),
  assets: svg('<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17z"/>')
})
