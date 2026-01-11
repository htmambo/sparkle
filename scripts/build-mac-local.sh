#!/bin/bash

################################################################################
# Sparkle macOS 本地打包脚本 (Intel x64)
# 用途：在本地 macOS 环境中构建 Sparkle 应用
# 平台：macOS Intel (x64)
################################################################################

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查系统环境
check_environment() {
    log_info "检查系统环境..."

    # 检查是否为 macOS
    if [[ $(uname) != "Darwin" ]]; then
        log_error "此脚本仅支持 macOS 系统"
        exit 1
    fi

    # 检查架构
    ARCH=$(uname -m)
    if [[ $ARCH != "x86_64" ]]; then
        log_warning "检测到架构: $ARCH"
        log_warning "此脚本针对 Intel (x86_64) 优化，Apple Silicon 可能需要调整"
    fi

    # 检查 Node.js
    if ! command -v node &> /dev/null; then
        log_error "未找到 Node.js，请先安装 Node.js >= 20.0.0"
        exit 1
    fi

    NODE_VERSION=$(node -v)
    log_info "Node.js 版本: $NODE_VERSION"

    # 检查 pnpm
    if ! command -v pnpm &> /dev/null; then
        log_error "未找到 pnpm，正在安装..."
        npm install -g pnpm
    fi

    PNPM_VERSION=$(pnpm -v)
    log_info "pnpm 版本: $PNPM_VERSION"

    # 检查 git
    if ! command -v git &> /dev/null; then
        log_error "未找到 git"
        exit 1
    fi

    # 检查 jq (JSON 处理工具)
    if ! command -v jq &> /dev/null; then
        log_warning "未找到 jq，正在安装..."
        brew install jq
    fi

    log_success "环境检查完成"
}

# 版本号处理
process_version() {
    local VERSION=$1
    local CURRENT_VERSION=$(jq -r '.version' package.json)
    local GIT_COMMIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

    if [[ -z "$VERSION" ]]; then
        # 自动版本：增加补丁号
        BASE_VERSION=$(echo $CURRENT_VERSION | awk -F. '{print $1"."$2"."$3+1}')
        VERSION_PREFIX="${VERSION_PREFIX:-beta}"
        RELEASE_VERSION="${BASE_VERSION}-${VERSION_PREFIX}-${GIT_COMMIT_HASH}"
        log_info "自动版本号: $RELEASE_VERSION"
    else
        # 手动版本号
        CLEAN_VERSION=$(echo "$VERSION" | sed 's/^v//')
        if [[ ! "$CLEAN_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            log_error "无效的版本号格式: $VERSION"
            log_error "正确格式: x.y.z (例如: 1.6.17)"
            exit 1
        fi
        RELEASE_VERSION="$CLEAN_VERSION"
        log_info "手动版本号: $RELEASE_VERSION"
    fi

    # 更新 package.json
    jq --arg version "$RELEASE_VERSION" '.version = $version' package.json > tmp.json && mv tmp.json package.json
    log_success "版本号已更新到 $RELEASE_VERSION"
}

# 清理旧的构建产物
clean_build() {
    log_info "清理旧的构建产物..."

    rm -rf dist/
    rm -rf out/

    log_success "清理完成"
}

# 安装依赖
install_dependencies() {
    log_info "安装项目依赖..."

    SKIP_PREPARE=1 pnpm install
    pnpm prepare --x64

    log_success "依赖安装完成"
}

# 构建应用
build_app() {
    log_info "开始构建 macOS 应用..."

    # 设置环境变量
    export npm_config_arch=x64
    export npm_config_target_arch=x64

    # 构建
    pnpm build:mac --x64

    log_success "构建完成"
}

# 生成 changelog
generate_changelog() {
    log_info "生成更新日志..."

    git log -1 --pretty=format:"%s%n%b" > changelog.md

    log_success "changelog.md 已生成"
}

# 生成 latest.yml
generate_latest_yml() {
    log_info "生成 latest.yml..."

    SKIP_CHANGELOG=1 pnpm updater

    log_success "latest.yml 已生成"
}

# 清理不需要的文件
cleanup_artifacts() {
    log_info "清理构建产物..."

    # 删除不需要的文件
    rm -f dist/sparkle.app.plist
    rm -f dist/*blockmap*

    log_success "清理完成"
}

# 显示构建结果
show_results() {
    local VERSION=$(jq -r '.version' package.json)

    echo ""
    echo "========================================"
    echo -e "${GREEN}构建完成！${NC}"
    echo "========================================"
    echo ""
    echo "版本号: $VERSION"
    echo "平台: macOS Intel (x64)"
    echo ""
    echo "构建产物位置:"
    echo "  - dist/sparkle-macos-${VERSION}-x64.pkg"
    echo "  - dist/latest.yml"
    echo "  - dist/changelog.md"
    echo ""
    echo "安装方式:"
    echo "  1. 双击 .pkg 文件进行安装"
    echo "  2. 或使用命令: sudo installer -pkg dist/sparkle-macos-${VERSION}-x64.pkg"
    echo ""
    echo "========================================"
}

# 主函数
main() {
    local VERSION=""

    # 解析参数
    while [[ $# -gt 0 ]]; do
        case $1 in
            --version)
                VERSION="$2"
                shift 2
                ;;
            --help|-h)
                echo "用法: $0 [--version VERSION]"
                echo ""
                echo "选项:"
                echo "  --version VERSION  指定版本号 (例如: 1.6.17)"
                echo "  --help, -h         显示此帮助信息"
                echo ""
                echo "示例:"
                echo "  $0                    # 自动版本 (补丁号+1)"
                echo "  $0 --version 1.6.17  # 指定版本"
                exit 0
                ;;
            *)
                log_error "未知参数: $1"
                echo "使用 --help 查看帮助"
                exit 1
                ;;
        esac
    done

    echo "========================================"
    echo "  Sparkle macOS 本地打包脚本"
    echo "  平台: Intel (x86_64)"
    echo "========================================"
    echo ""

    # 执行构建流程
    check_environment
    process_version "$VERSION"
    clean_build
    install_dependencies
    build_app
    generate_changelog
    generate_latest_yml
    cleanup_artifacts
    show_results
}

# 运行主函数
main "$@"
