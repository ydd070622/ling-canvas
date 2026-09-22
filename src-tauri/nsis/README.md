# src-tauri/nsis/

`installer.nsi` 是**Tauri 安装包模板的本地副本**，不是 tauri CLI 自带的那份。

`tauri.conf.json` 里通过 `bundle.windows.nsis.template` 指向它：

```json
"nsis": { "template": "nsis/installer.nsi" }
```

这套做法照搬自 `E:\01-Vibe coding\08-施工报价系统`（家装施工报价系统），
两边用的是同一个 Tauri CLI 版本（2.11.4），所以模板可以直接互通。

## 为什么要有这份副本

Tauri 的模板在检测到系统里已装过本软件时，会插入一页维护页 (`PageReinstall`)，
让用户在「添加/重新安装组件」和「卸载 Ling Canvas」之间选一次。
**Tauri 2.11.4 没有任何配置项能关掉它** —— `nsis` 段只有
`template / headerImage / sidebarImage / installerIcon / installMode / languages /
customLanguageFiles / displayLanguageSelector / compression / startMenuFolder /
installerHooks / minimumWebview2Version` 这些。

命令行开关也不行：`/UPDATE` 只影响「要不要先卸载」（模板里 `$UpdateMode = 1` 时
`PageLeaveReinstall` 直接 `goto reinst_done`），页面照样弹；只有 `/P`（passive）
会跳过页面 UI，但它同时会跳过「选择安装目录」那一页，新电脑上就没法选目录了。

所以只能拿一份模板副本改。改的地方只有两处，都在文件里搜「**本地改动**」能找到。

## 两处本地改动

1. **`PageReinstall`：已装即原地覆盖，不弹维护页**
   检测到已装同版本 (0) 或旧版本 (1) 时，直接 `StrCpy $UpdateMode 1` + `Abort` 跳过整页。
   降级 (`$R0 = -1`) 和 WiX 迁移 (`$WixMode = 1`) 仍走模板原逻辑，保留提示。
   `$INSTDIR` 由 `.onInit` 的 `RestorePreviousInstallLocation` 从注册表恢复，
   所以还是装回上次那个目录（比如 `G:\program\Ling Canvas`），不会跑到默认目录。

   > 装机时的实际页面顺序：欢迎 → 选择安装位置 → 安装 → 完成。
   > 维护页在「全新安装」和「已装旧版」两种情况下都不会出现。

2. **欢迎页文案：修中文行距**
   MUI 欢迎页正文控件的行高是按英文字体度量算的，中文**软折行**之后行距不够，
   几行会叠在一起糊成一团。改成每行都短到不折行、靠 `$\r$\n` 手动断行。
   改文案时一行别超过约 25 个汉字。

## 中文界面

`tauri.conf.json` 里 `languages` 只列了 `SimpChinese`，所以安装界面全中文
（NSIS 的 `Contrib\Language files\SimpChinese.nlf`）。

产品名仍是 **Ling Canvas**（`productName`），它是品牌名，会出现在标题、
安装目录名和快捷方式名里。**别为了「界面全中文」去改 `productName`** ——
NSIS 用它拼注册表键（`${MANUPRODUCTKEY}` = `Software\lingcanvas\Ling Canvas`）
和卸载键，改了之后认不出已装的旧版本，会装成两份、旧版残留。

## 安装前自动关掉运行中的旧版本

见 `installer-hooks.nsh`（由 `bundle.windows.nsis.installerHooks` 引入）。
模板默认在 `CheckIfAppIsRunning` 那里弹确认框，点取消就中断安装；
钩子把插入点提前，先强杀进程，全程不需要确认。

## 升级 @tauri-apps/cli 之后必须重新对齐

模板是编译进 cli 原生二进制里的（`include_str!`），版本一变就得重新取一份：

```bash
python scripts/extract_nsis_template.py -o new.nsi
git diff --no-index src-tauri/nsis/installer.nsi new.nsi
```

把两处「本地改动」搬到 `new.nsi` 上，覆盖本目录的 `installer.nsi` 即可。
**别丢掉这两处** —— 丢了不会报错，只是维护页和叠字会回来。

## 数据在哪（覆盖安装/卸载会不会丢）

画布项目数据在 **WebView2 的 user-data 目录**：
`%LOCALAPPDATA%\com.lingcanvas.app\EBWebView`（localStorage + IndexedDB）。

素材库根目录如果设过，路径记在 `%APPDATA%\com.lingcanvas.app`（`app_config_dir()`）。

两者都在安装目录之外，**覆盖安装只动安装目录，数据不受影响**。

⚠ 唯一会删数据的是**卸载程序**里那个「删除应用程序数据」勾选框
（模板里的 `$DeleteAppDataCheckboxState`）—— 它会 `RmDir /r` 掉上面两个目录，
连画布项目一起清空。卸载时别勾。

## 打包与验证

```bash
pnpm tauri build      # 产出 target/release/bundle/nsis/Ling Canvas_<版本>_x64-setup.exe
```

> 本仓库 `src-tauri/.cargo/config.toml` 把 target-dir 指到了 `E:\lc-target`
> （为了绕开工程路径含空格导致 windres 失败），所以实际产物在
> `E:\lc-target\release\bundle\nsis\` 下。

打包时 bundler 会把模板渲染（替换 `{{...}}` 占位符）后写到
`E:\lc-target\release\nsis\<arch>\installer.nsi` 再交给 makensis。
想确认自定义模板确实生效且没有副作用，可以把它和默认模板渲染出来的结果对比：
差异应该只有上面那两处。

验证覆盖安装：先装一个旧版本，再双击新安装包，应该**不再出现维护页**，
一路「下一步」装完后打开软件，画布项目仍在。
