#!/usr/bin/env bash
#
# 发现「需要同步到子仓库」的目录 —— 判据与站点根的 .make-index.ps1 完全一致。
#
# 规则
#   1. 从站点根往下走，只有「名字以大写字母 A-Z 开头」的目录才继续下探；
#      任何一级是小写开头（Cube/assets、assets、supabase、ui…），整支跳过。
#   2. 每走进一个这样的目录，它自己就是一个同步目标（站点根自身不算目标）。
#   3. 目标仓库名 = 该目录相对路径把 "/" 换成 "-"：Cube/Formula → Cube-Formula。
#   4. 目标仓库在 GitHub 上不存在 → 打印警告并跳过（以后建了同名仓库会自动纳入）。
#
# 用法：discover-sync-targets.sh <站点根目录>
# 环境：TARGET_OWNER（默认 Ckarefulon）、REPO_TOKEN（可选，查私有仓库用）
#       SKIP_REMOTE_CHECK=1 跳过远端探活（本地干跑用）
# 输出：写 $GITHUB_OUTPUT（count / matrix），同时在日志里打印清单。
set -euo pipefail
export LC_ALL=C

SITE_ROOT="${1:-.}"
OWNER="${TARGET_OWNER:-Ckarefulon}"
TOKEN="${REPO_TOKEN:-}"

# ---------- 1. 收集候选目录 ----------

candidates=()
walk() {
	local dir="$1" rel="$2" child name relchild
	while IFS= read -r -d '' child; do
		name="${child##*/}"
		[[ "$name" == [A-Z]* ]] || continue   # 首字母必须大写，小写整支不进
		[[ -L "$child" ]] && continue         # 真符号链接跳过，避免递归成环
		relchild="${rel:+$rel/}$name"
		candidates+=("$relchild")
		walk "$child" "$relchild"
	done < <(find "$dir" -mindepth 1 -maxdepth 1 -type d -print0 | sort -z)
}
walk "$SITE_ROOT" ""

# ---------- 2. 目标仓库探活 ----------

# 先问 git（公开仓库无 token 也能读；带上 token 则私有仓库也能读），
# 拿不准时再问 API：只有 API 明确回 404 才判定「仓库不存在」。
# 其余情况（限流、网络抖动、token 权限不足）一律按「存在」处理 ——
# 宁可让那一格 job 报错给人看，也不要静默漏掉一次同步。
repo_exists() {
	local repo="$1" url code
	if [ -n "$TOKEN" ]; then
		url="https://x-access-token:${TOKEN}@github.com/${OWNER}/${repo}.git"
	else
		url="https://github.com/${OWNER}/${repo}.git"
	fi
	if git ls-remote --exit-code "$url" HEAD >/dev/null 2>&1; then
		return 0
	fi

	if [ -n "$TOKEN" ]; then
		code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 \
			-H "Accept: application/vnd.github+json" \
			-H "Authorization: Bearer $TOKEN" \
			"https://api.github.com/repos/$OWNER/$repo" 2>/dev/null || true)"
	else
		code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 \
			-H "Accept: application/vnd.github+json" \
			"https://api.github.com/repos/$OWNER/$repo" 2>/dev/null || true)"
	fi

	if [ "$code" = "404" ]; then
		return 1
	fi
	[ "$code" = "200" ] && return 0
	echo "::warning::探测 $OWNER/$repo 未得到明确结论（HTTP ${code:-无响应}），按「存在」处理"
	return 0
}

include=() missing=()
for rel in "${candidates[@]}"; do
	repo="${rel//\//-}"
	if [ "${SKIP_REMOTE_CHECK:-0}" = "1" ]; then
		include+=("$rel")
		continue
	fi
	if repo_exists "$repo"; then
		include+=("$rel")
	else
		missing+=("$rel|$repo")
	fi
done

# ---------- 3. 输出 ----------

json='{"include":['
sep=''
for rel in "${include[@]}"; do
	json+="$sep{\"target_repo\":\"${rel//\//-}\",\"source_path\":\"$rel\"}"
	sep=','
done
json+=']}'

if [ -n "${GITHUB_OUTPUT:-}" ]; then
	{
		echo "count=${#include[@]}"
		echo "matrix=$json"
	} >> "$GITHUB_OUTPUT"
fi

echo "站点根：$SITE_ROOT"
echo "大写开头的目录 ${#candidates[@]} 个："
for rel in "${candidates[@]}"; do echo "  - $rel  →  $OWNER/${rel//\//-}"; done
echo "命中目标仓库 ${#include[@]} 个"
if [ "${#missing[@]}" -gt 0 ]; then
	echo '::warning::以下目录在 GitHub 上没有对应的同名仓库，本次跳过：'
	for m in "${missing[@]}"; do echo "  - ${m%%|*}  →  $OWNER/${m##*|}"; done
fi
