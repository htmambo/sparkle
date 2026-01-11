#!/bin/bash

################################################################################
# Sparkle 调试版本构建脚本
# 用途：构建带有开发者工具的生产版本，用于调试窗口空白问题
################################################################################

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

echo "========================================="
echo "  Sparkle 调试版本构建"
echo "========================================="
echo ""

# 检查环境变量
log_info "设置调试环境变量..."
export DEBUG_SPARKLE=true
log_success "DEBUG_SPARKLE=true"
echo ""

# 运行正常构建
log_info "开始构建..."
./scripts/build-mac-local.sh

echo ""
log_info "构建完成！"
echo ""
log_warning "注意：调试版本会自动打开开发者工具"
log_warning "如果需要正常版本，请运行: ./scripts/build-mac-local.sh"
