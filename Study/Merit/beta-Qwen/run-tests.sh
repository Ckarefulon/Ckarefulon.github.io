#!/usr/bin/env bash
# 一键跑完全部测试（无需任何依赖，只要有 Node.js）
set -e
cd "$(dirname "$0")"
echo "════════ 综测算分器 · 测试套件 ════════"
for t in engine render degraded; do
  echo ""
  echo "▶ tests/$t.test.js"
  node "tests/$t.test.js" | tail -3
done
echo ""
echo "▶ 构建单文件产物"
python3 build.py
echo ""
echo "✅ 全部通过"
