#!/bin/bash

################################################################################
# Sparkle 打包应用调试脚本
# 用途：诊断打包后的应用为什么窗口空白
################################################################################

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

APP_PATH="dist/mac/Sparkle.app"

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

echo "========================================="
echo "  Sparkle 打包应用诊断"
echo "========================================="
echo ""

# 1. 检查应用是否存在
if [ ! -d "$APP_PATH" ]; then
    log_error "应用不存在: $APP_PATH"
    echo "请先运行构建脚本"
    exit 1
fi

log_success "应用存在: $APP_PATH"
echo ""

# 2. 检查 app.asar
log_info "检查 app.asar..."
ASAR_PATH="$APP_PATH/Contents/Resources/app.asar"
if [ ! -f "$ASAR_PATH" ]; then
    log_error "app.asar 不存在"
    exit 1
fi

ASAR_SIZE=$(du -h "$ASAR_PATH" | cut -f1)
log_success "app.asar 存在 ($ASAR_SIZE)"
echo ""

# 3. 检查 renderer 文件
log_info "检查 renderer 文件..."
RENDERER_HTML=$(npx asar list "$ASAR_PATH" | grep "renderer/index.html")
if [ -z "$RENDERER_HTML" ]; then
    log_error "renderer/index.html 不存在于 asar 包中"
    echo "asar 包内容："
    npx asar list "$ASAR_PATH" | grep -E "renderer|out" | head -20
    exit 1
fi

log_success "renderer/index.html 存在"
echo ""

# 4. 检查 preload 脚本
log_info "检查 preload 脚本..."
PRELOAD_JS=$(npx asar list "$ASAR_PATH" | grep "preload/index.js")
if [ -z "$PRELOAD_JS" ]; then
    log_warning "preload/index.js 不存在于 asar 包中"
else
    log_success "preload/index.js 存在"
fi
echo ""

# 5. 提取并检查 index.html
log_info "提取并检查 index.html..."
npx asar extract "$ASAR_PATH" /tmp/sparkle-asar-check 2>/dev/null

if [ -f "/tmp/sparkle-asar-check/out/renderer/index.html" ]; then
    log_success "index.html 提取成功"

    # 检查是否有脚本引用
    SCRIPT_COUNT=$(grep -c "script" /tmp/sparkle-asar-check/out/renderer/index.html || true)
    log_info "HTML 中 script 标签数量: $SCRIPT_COUNT"

    # 显示 HTML 内容
    echo ""
    echo "--- index.html 内容 ---"
    head -30 /tmp/sparkle-asar-check/out/renderer/index.html
    echo "..."
fi
echo ""

# 6. 检查主进程加载代码
log_info "检查主进程加载代码..."
MAIN_JS=$(npx asar extract "$ASAR_PATH" - --quiet 2>/dev/null | grep -A 5 "loadFile.*renderer" || true)
if [ -n "$MAIN_JS" ]; then
    echo "$MAIN_JS"
else
    log_warning "未找到 loadFile 相关代码"
fi
echo ""

# 7. 运行应用并获取日志
log_info "运行应用并收集日志..."
log_warning "请在打开的应用窗口中按 Cmd+Option+I 打开开发者工具"
log_warning "查看 Console 标签页是否有错误信息"
echo ""

log_info "启动应用..."
open "$APP_PATH"

echo ""
echo "========================================="
log_info "诊断完成"
echo "========================================="
echo ""
echo "下一步操作："
echo "1. 检查打开的应用窗口"
echo "2. 按 Cmd+Option+I 打开开发者工具"
echo "3. 查看 Console 标签页的错误信息"
echo "4. 查看 Network 标签页，确认资源是否加载失败"
echo ""
echo "如果看到空白窗口，可能的原因："
echo "- CSP 策略阻止了脚本执行"
echo "- preload 脚本加载失败"
echo "- React 渲染出错"
echo "- 资源路径错误"
echo ""

# 清理临时文件
rm -rf /tmp/sparkle-asar-check
