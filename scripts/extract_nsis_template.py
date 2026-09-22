# -*- coding: utf-8 -*-
"""
从 @tauri-apps/cli 的原生二进制里取出 NSIS 安装包模板（installer.nsi 的原文）。

为什么需要它：src-tauri/nsis/installer.nsi 是 Tauri 模板的本地副本（改过两处，
见该文件头部注释）。Tauri 升级后那份副本会变旧，得用这个脚本重新取一份新的来对比。

模板是编译进 cli 的 .node 二进制里的（include_str!），不是独立文件，所以只能这样挖。
挖法是「找唯一的锚点字符串，再向前后扩到边界」：
  - 起点：既有的 "Function PageReinstall" 之前、最近的 "Unicode true"（模板第一行）
  - 终点：起点之后第一个 \\0（C 字符串结尾）

用法：
    python scripts/extract_nsis_template.py                 # 输出到临时目录并打印路径
    python scripts/extract_nsis_template.py -o new.nsi      # 指定输出文件
    python scripts/extract_nsis_template.py -b <二进制路径>  # 手动指定 cli 二进制

取出后和仓库里那份对比：
    git diff --no-index src-tauri/nsis/installer.nsi new.nsi
把里面两处「本地改动」搬到新模板上（搜索「本地改动」即可找到），替换仓库里的文件。
"""
import argparse
import glob
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANCHOR = b"Function PageReinstall"
START_MARK = b"Unicode true"


def cli_version():
    p = os.path.join(REPO, "node_modules", "@tauri-apps", "cli", "package.json")
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f).get("version", "?")
    except OSError:
        return "?"


def find_binary(explicit=None):
    if explicit:
        return explicit
    # pnpm 把平台包放在 .pnpm 的虚拟store里；npm/yarn 直接在 node_modules 下
    patterns = [
        os.path.join(REPO, "node_modules", ".pnpm", "@tauri-apps+cli-*", "node_modules",
                     "@tauri-apps", "cli-*", "*.node"),
        os.path.join(REPO, "node_modules", "@tauri-apps", "cli-*", "*.node"),
    ]
    for pat in patterns:
        hits = glob.glob(pat)
        if hits:
            # 同一台机器上可能有多个平台包（交叉编译装过别的平台），优先当前平台
            here = [h for h in hits if sys.platform.replace("win32", "win32") in h]
            return sorted(here or hits)[0]
    raise SystemExit("找不到 cli 原生二进制，用 -b 手动指定路径")


def extract(binary):
    with open(binary, "rb") as f:
        b = f.read()
    i = b.find(ANCHOR)
    if i < 0:
        raise SystemExit(
            "二进制里没有找到 " + ANCHOR.decode() + "，这个 CLI 版本的模板可能换了形式，"
            "需要人工确认（先看 target/release/nsis/<arch>/installer.nsi 长什么样）")
    start = b.rfind(START_MARK, 0, i)
    if start < 0:
        raise SystemExit("在锚点之前没找到模板起始标记 " + START_MARK.decode())
    end = b.find(b"\x00", start)
    if end < 0:
        raise SystemExit("没找到模板结尾（\\0）")
    raw = b[start:end]
    # \0 之前还夹着几个非文本字节（字符串常量后面紧跟的其它数据），
    # 砍到最后一个换行为止，否则尾部会带进乱码，makensis 编译时会报错。
    cut = raw.rfind(b"\n")
    if cut < 0:
        raise SystemExit("取出来的片段里没有换行，八成不对")
    raw = raw[:cut + 1]
    txt = raw.decode("utf-8")  # 严格解码：故意不用 errors=replace，坏字节要当场暴露
    if "{{" not in txt:
        raise SystemExit("取出来的内容里没有 handlebars 占位符，八成不是模板，别用")
    return txt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-b", "--binary", help="cli 原生二进制路径（.node）")
    ap.add_argument("-o", "--out", help="输出文件；不给就写到临时目录")
    ap.add_argument("--version", help="只打印 CLI 版本后退出")
    args = ap.parse_args()

    if args.version:
        print(cli_version())
        return

    binary = find_binary(args.binary)
    txt = extract(binary)
    out = args.out or os.path.join(
        os.environ.get("TEMP", "/tmp"), "installer-%s.nsi" % cli_version())
    with open(out, "w", encoding="utf-8", newline="") as f:
        f.write(txt)

    print("CLI 版本 : %s" % cli_version())
    print("二进制   : %s" % binary)
    print("模板     : %d 字节, %d 行, %d 个 handlebars 占位符"
          % (len(txt.encode("utf-8")), txt.count("\n") + 1, len(re.findall(r"\{\{", txt))))
    print("已写出   : %s" % out)
    print()
    print("和仓库那份对比：")
    print("  git diff --no-index %s %s" % (
        os.path.relpath(os.path.join(REPO, "src-tauri", "nsis", "installer.nsi"), os.getcwd()), out))
    print("（diff 里的两处「本地改动」要搬到新模板上，别丢）")


if __name__ == "__main__":
    main()
