#!/bin/sh
# intake/paths.sh - 总库写入路径边界
# 需先 source common.sh
#
# 设计约束（spec 5.3、design 18.3）：
#   1. 任何写入总库的路径都必须先经本模块校验；未校验的相对路径不得直接拼接
#   2. 单段名称（规则 id、资产名、文件名）不得包含路径分隔符，也不得是 . 或 ..
#   3. 总库相对路径不得是绝对路径，不得含 . / .. 段或空段
#   4. 最终写入路径解析父目录与目标本身的符号链接后，必须仍落在总库内
#
# 之所以自己实现而不是用 realpath：macOS 与 GNU 的 realpath 参数不同，
# 且目标路径通常尚不存在（新增场景），realpath -e 会直接失败。

# 单一路径段是否安全（规则 id、资产名、文件名）
intake_is_safe_segment() {
  local s="$1"
  [ -n "$s" ] || return 1
  case "$s" in
    .|..) return 1 ;;
    */*) return 1 ;;
  esac
  # 控制字符（含换行）会让 cp/mv 与记录解析失控
  if printf '%s' "$s" | LC_ALL=C grep -q '[[:cntrl:]]' 2>/dev/null; then
    return 1
  fi
  return 0
}

# 总库相对路径是否安全（不要求路径存在）
intake_is_safe_rel_path() {
  local p="$1" rest seg
  [ -n "$p" ] || return 1
  case "$p" in
    /*) return 1 ;;
    */) return 1 ;;
  esac
  if printf '%s' "$p" | LC_ALL=C grep -q '[[:cntrl:]]' 2>/dev/null; then
    return 1
  fi

  rest="$p"
  while : ; do
    seg="${rest%%/*}"
    intake_is_safe_segment "$seg" || return 1
    case "$rest" in
      */*) rest="${rest#*/}" ;;
      *) break ;;
    esac
  done
  return 0
}

# 解析符号链接链（上限 20 跳，防止循环）
intake_resolve_links() {
  local p="$1" hops=0 t
  while [ -L "$p" ] && [ "$hops" -lt 20 ]; do
    t="$(readlink "$p" 2>/dev/null)" || break
    [ -n "$t" ] || break
    case "$t" in
      /*) p="$t" ;;
      *)  p="$(dirname "$p")/$t" ;;
    esac
    hops=$((hops + 1))
  done
  printf '%s' "$p"
}

# 物理绝对路径：解析符号链接，不要求路径存在
# 做法：先把不存在的最长后缀摘下来，解析剩余部分，再把后缀原样拼回
intake_physical_path() {
  local p="$1" suffix="" parent
  case "$p" in
    /*) ;;
    *) p="${PWD}/$p" ;;
  esac

  while [ ! -e "$p" ] && [ ! -L "$p" ]; do
    suffix="/$(basename "$p")${suffix}"
    parent="$(dirname "$p")"
    [ "$parent" != "$p" ] || break
    p="$parent"
  done

  p="$(intake_resolve_links "$p")"
  if [ -d "$p" ]; then
    p="$(cd -P "$p" 2>/dev/null && pwd || printf '%s' "$p")"
  else
    p="$(cd -P "$(dirname "$p")" 2>/dev/null && pwd || dirname "$p")/$(basename "$p")"
  fi
  printf '%s%s' "$p" "$suffix"
}

# 绝对路径是否落在总库内（解析符号链接后判断）
intake_within_repo() {
  local repo="$1" abs="$2" rp ap
  rp="$(intake_physical_path "$repo")"
  ap="$(intake_physical_path "$abs")"
  case "$ap" in
    "$rp"/*) return 0 ;;
  esac
  return 1
}

# 校验总库相对路径并拼成绝对路径；不安全时返回 1 且不输出
intake_repo_abs_path() {
  local repo="$1" rel="$2" abs
  intake_is_safe_rel_path "$rel" || return 1
  abs="${repo}/${rel}"
  intake_within_repo "$repo" "$abs" || return 1
  printf '%s' "$abs"
}
