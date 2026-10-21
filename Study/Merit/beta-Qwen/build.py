#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build.py —— 把 src/ 下的多文件源码打包成"单文件成品" index.html

为什么要有单文件版？
  · 学生用户拿到就能用：双击打开、微信/QQ 传文件、U 盘拷贝都可以，
    不需要起服务器、不需要 npm、不需要联网。
  · 内嵌全部 CSS/JS，在受限的网页预览窗口里也能完整渲染（不依赖外部资源）。

用法：
  python3 build.py            # 生成 ../index.html
  python3 build.py --check    # 只校验，不写文件
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'src')
OUT = os.path.join(HERE, 'index.html')

BANNER = """<!--
  ╔═══════════════════════════════════════════════════════════════╗
  ║  综测算分器 · 西安交通大学本科生综合素质测评                     ║
  ║  单文件成品版（由 src/ 构建生成，请勿直接改本文件）              ║
  ║                                                               ║
  ║  要改样式/逻辑：编辑 src/css/app.css 与 src/js/*.js            ║
  ║  然后运行  python3 build.py  重新生成本文件                    ║
  ║                                                               ║
  ║  纯静态、无后端、无依赖、可离线；数据仅保存在浏览器本地          ║
  ╚═══════════════════════════════════════════════════════════════╝
-->
"""


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def inline_css(html):
    def repl(m):
        href = m.group(1)
        path = os.path.join(SRC, href)
        css = read(path)
        return '<style>\n/* ===== 内联自 %s ===== */\n%s\n</style>' % (href, css)
    return re.sub(r'<link rel="stylesheet" href="([^"]+)">', repl, html)


def inline_js(html):
    def repl(m):
        src = m.group(1)
        path = os.path.join(SRC, src)
        js = read(path)
        if '</script' in js.lower():
            raise SystemExit('✗ %s 含 </script> 字样，无法安全内联' % src)
        return '<script>\n/* ===== 内联自 %s ===== */\n%s\n</script>' % (src, js)
    return re.sub(r'<script src="([^"]+)"></script>', repl, html)


def main():
    check_only = '--check' in sys.argv
    html = read(os.path.join(SRC, 'index.html'))

    # 校验：所有被引用的资源都存在
    missing = [m for m in re.findall(r'(?:href|src)="((?:css|js)/[^"]+)"', html)
               if not os.path.exists(os.path.join(SRC, m))]
    if missing:
        raise SystemExit('✗ src/index.html 引用了不存在的文件：' + ', '.join(missing))

    js_files = re.findall(r'<script src="js/([^"]+)"></script>', html)
    out = inline_js(inline_css(html))

    # ⚠ 横幅注释必须插在 <!DOCTYPE html> 之后：
    #   HTML 解析规范中，DOCTYPE 前若出现注释会先切到 "before html" 模式，
    #   而该模式下 DOCTYPE 记号会被直接忽略 → 浏览器进入怪异模式(quirks mode)，布局会崩。
    m = re.match(r'\s*(<!DOCTYPE[^>]*>)', out, re.I)
    if not m:
        raise SystemExit('✗ src/index.html 缺少 <!DOCTYPE html> 声明')
    out = m.group(1) + '\n' + BANNER + out[m.end():]

    # 断言：DOCTYPE 必须是文档第一个记号
    if not re.match(r'\s*<!DOCTYPE\s+html\s*>', out, re.I):
        raise SystemExit('✗ 产物首个记号不是 <!DOCTYPE html>，会触发怪异模式')

    # 断言：不应再有任何外部引用
    leftover = re.findall(r'(?:href|src)="(?!data:|#)([^"]+)"', out)
    if leftover:
        raise SystemExit('✗ 仍存在外部引用，无法离线运行：' + ', '.join(leftover))

    size = len(out.encode('utf-8'))
    print('构建成功 → index.html')
    print('  内联脚本顺序：' + ' → '.join(js_files))
    print('  产物大小：%.1f KB（%d 行）' % (size / 1024, out.count('\n') + 1))
    if size > 3 * 1024 * 1024:
        raise SystemExit('✗ 产物超过 3MB，请检查是否误引入了大文件')

    if not check_only:
        with open(OUT, 'w', encoding='utf-8') as f:
            f.write(out)
        print('  已写入：' + OUT)
    else:
        print('  （--check 模式，未写入文件）')


if __name__ == '__main__':
    main()
