; 安装包的自定义 NSIS 钩子。
;
; 由 tauri.conf.json 的 bundle.windows.nsis.installerHooks 引入，
; 在 installer.nsi 第 52 行被 !include——早于所有 Section，所以下面这些宏
; 在这里定义是安全的。（宏体里的 ${MAINBINARYNAME} 是插入时才替换的，
; 那个 define 在第 70 行，不影响。）

; ── 安装前先关掉正在运行的旧版本 ──────────────────────────────
;
; 为什么需要：installer.nsi 的 Section Install 里，钩子插入点（第 701 行）
; 排在 CheckIfAppIsRunning（第 705 行）之前。默认行为是弹一个
; 「Ling Canvas 正在运行！点击确定以终止运行」的对话框：点确定才会杀掉进程继续，
; 点取消就直接中断并提示「请关闭后再试」——于是双击安装包并不能一路装完。
; 这里提前把进程杀掉，后面的检查自然无事通过，全程不需要任何确认。
;
; 代价：强杀会跳过 beforeunload 的收尾保存。画布改动由 canvas.js 的自动保存
; （autoSaveEnabled，防抖落盘）兜着，正常情况下只丢最后一次防抖窗口内的编辑；
; 但正在跑的生成任务会直接中断，那部分结果不会回来。
;
; 用的是 tauri 自带的 nsis_tauri_utils 插件（与模板同一套调用），
; installMode 是 currentUser，所以用 ...CurrentUser 这两个函数。
!macro NSIS_HOOK_PREINSTALL
  ; 编译期打一条 warning。!ifmacrodef 在宏名写错时会静默跳过、照样编译通过，
  ; 肉眼完全看不出来；有这条，打包日志里就能确认钩子真的生效了。
  ; 用 !warning 而不是 !echo——这个 NSIS 版本里 !echo 不往输出里打印，
  ; 拿它当标记会被误判成「宏没插进去」。
  !warning "installer-hooks: NSIS_HOOK_PREINSTALL 已插入（安装前先关闭运行中的旧版本）"

  nsis_tauri_utils::FindProcessCurrentUser "${MAINBINARYNAME}.exe"
  Pop $R0
  ${If} $R0 = 0
    nsis_tauri_utils::KillProcessCurrentUser "${MAINBINARYNAME}.exe"
    Pop $R0
    ; 给文件句柄和 WebView2 的 user-data 目录一点时间释放，
    ; 否则紧接着覆盖 exe 会失败
    Sleep 800
  ${EndIf}
!macroend
