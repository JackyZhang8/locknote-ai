#!/bin/bash
# 开发用：wails dev —— 原生窗口 + Go 改动自动重编译
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

# wails 在 ~/go/bin，go 在 /usr/local/go；wails 内部还要用 sysctl/clang 等系统命令，
# 所以把系统目录也显式放进 PATH，避免从非登录 shell 启动时找不到。
export PATH="$HOME/go/bin:/usr/local/go/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

if ! command -v wails >/dev/null 2>&1; then
  echo "找不到 wails，请先安装：go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "找不到 npm，请先安装 Node.js 20 或更新版本。" >&2
  exit 1
fi

# Go embeds the Vite output even during development. Bootstrap it before Wails
# compiles the backend; Wails then runs Vite's watcher for frontend hot reload.
if [ ! -d frontend/node_modules ]; then
  npm --prefix frontend ci
fi
npm --prefix frontend run build

# 没有绑定的 Go 方法，跳过 bindings 生成（否则 wails 会先把应用跑一遍）
CC=/usr/bin/clang CXX=/usr/bin/clang++ exec wails dev -skipbindings
