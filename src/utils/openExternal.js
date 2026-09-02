/**
 * Open External URL | 打开外部链接
 * In desktop environment (Tauri), opens in system default browser
 * In web environment, uses window.open
 */

/**
 * Detect if running in desktop environment | 检测是否在桌面环境
 */
export const isDesktop = () => {
  const ua = navigator.userAgent
  return ua.includes('Tauri') || ua.includes('Electron')
}

/**
 * Open a URL - in system browser for desktop, new tab for web
 * @param {string} url - URL to open
 */
export const openExternal = async (url) => {
  if (isDesktop()) {
    try {
      const { open } = await import('@tauri-apps/plugin-shell')
      await open(url)
    } catch (e) {
      console.warn('Failed to open external URL via Tauri shell:', e)
      // Fallback to window.open
      window.open(url, '_blank')
    }
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}
