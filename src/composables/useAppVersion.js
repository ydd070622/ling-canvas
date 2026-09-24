/**
 * 应用版本号 | App version
 *
 * 仓库里有**两个**版本号，会各自漂移：`package.json` 的（前端包）和
 * `src-tauri/tauri.conf.json` 的（Tauri 包）。**安装包往 Windows「程序和功能」
 * 里写的是后者** —— 用户问"我装的是哪一版"，答案必须以 Tauri 的为准，
 * 所以优先走 `getVersion()`，而不是把数字写死在前端。
 *
 * `getVersion()` 只在 Tauri webview 里可用，`pnpm dev` 在纯浏览器里跑时会抛错；
 * 这时回退到构建时注入的 `__APP_VERSION__`（见 vite.config.js），
 * 免得开发时那一行是空白。
 */
import { ref } from 'vue'
import { getVersion } from '@tauri-apps/api/app'

export const appVersion = ref(__APP_VERSION__)

// Tauri v2 injects this only inside the webview | 仅在 Tauri webview 内注入
const isTauri = '__TAURI_INTERNALS__' in window

if (isTauri) {
  getVersion()
    .then((version) => {
      if (version) appVersion.value = version
    })
    .catch((err) => {
      console.warn('[useAppVersion] getVersion 失败，沿用 package.json 版本:', err)
    })
}
