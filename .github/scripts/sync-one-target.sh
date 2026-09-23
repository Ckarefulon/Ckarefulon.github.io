#!/usr/bin/env bash
#
# 把一个「同步目标」按规则搬进目标仓库工作区（判据同 .make-index.ps1）。
#
# 同步内容
#   ① 目标目录自身：整份内容（各级子目录、文件，不分大小写）都同步。
#   ② 它的各级父目录（一直数到站点根）：只同步「小写字母开头」的项，文件与目录都算，
#      在目标仓库里保持相同的相对路径；大写开头的兄弟目录（别的子站）不动。
#
# 例：Cube/Formula →
#       Cube/Formula/**                                   （① 整份）
#     + Cube/assets/**                                    （② Cube 下的小写项）
#     + assets/** nav/** ui/** user/** jump/** linkage/** supabase/**
#       index.html 404.html favicon.svg                   （② 站点根下的小写项）
#
# 用法：sync-one-target.sh <源根> <目标根> <相对路径>
#       sync-one-target.sh source target Cube/Formula
set -euo pipefail
export LC_ALL=C

SOURCE_ROOT="${1:?用法: sync-one-target.sh <源根> <目标根> <相对路径>}"
TARGET_ROOT="${2:?用法: sync-one-target.sh <源根> <目标根> <相对路径>}"
SRC="${3:?用法: sync-one-target.sh <源根> <目标根> <相对路径>}"
SRC="${SRC%/}"

# ---------- ① 目标目录自身：整份内容 ----------

if [ ! -d "$SOURCE_ROOT/$SRC" ]; then
	echo "::error::$SOURCE_ROOT/$SRC 不存在"
	exit 1
fi
mkdir -p "$TARGET_ROOT/$SRC"
cp -a "$SOURCE_ROOT/$SRC/." "$TARGET_ROOT/$SRC/"
echo "  [整份] $SRC/"

# ---------- ② 各级父目录中的「小写字母开头」项 ----------

parent="$(dirname "$SRC")"
while :; do
	case "$parent" in
		'.'|'/'|'') prefix='' ;;
		*)          prefix="$parent/" ;;
	esac
	while IFS= read -r -d '' item; do
		name="${item##*/}"
		[[ "$name" == [a-z]* ]] || continue   # 只要小写开头，大写兄弟与点开头都不算
		if [ -d "$item" ]; then
			mkdir -p "$TARGET_ROOT/${prefix}$name"
			cp -a "$item/." "$TARGET_ROOT/${prefix}$name/"
			echo "  [父目录小写项] ${prefix}$name/"
		else
			mkdir -p "$TARGET_ROOT/${prefix}"
			cp -a "$item" "$TARGET_ROOT/${prefix}$name"
			echo "  [父目录小写项] ${prefix}$name"
		fi
	done < <(find "$SOURCE_ROOT/${parent#./}" -mindepth 1 -maxdepth 1 -print0)
	[ "$parent" = '.' ] && break
	parent="$(dirname "$parent")"
done
