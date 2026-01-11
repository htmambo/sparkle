# Sparkle 性能优化任务计划

## 目标

基于 Codex 性能审核报告，分阶段实施优化，提升应用启动速度、降低资源占用、优化 CI/CD 效率。

---

## 阶段 1：快速见效优化（1-2 周）

### 任务 1.1：CI 依赖缓存 ✅
**优先级**：🔴 高
**预期收益**：依赖安装时间 ↓ 60-80%
**实施难度**：⭐⭐ 低

**实施步骤**：
1. 添加 actions/setup-node@v4
2. 启用 pnpm 缓存
3. 添加 Electron 缓存

**相关文件**：
- `.github/workflows/build.yml`

**验收标准**：
- CI 中依赖安装时间减少
- 缓存正确命中

---

### 任务 1.2：路由懒加载 ✅
**优先级**：🔴 最高
**预期收益**：首屏加载时间 ↓ 40-60%
**实施难度**：⭐⭐⭐ 中

**实施步骤**：
1. 修改 `src/renderer/src/routes/index.tsx`
2. 使用 React.lazy() 动态导入所有页面
3. 添加 Suspense 包装
4. 添加加载态组件

**相关文件**：
- `src/renderer/src/routes/index.tsx`
- `src/renderer/src/routes/index.tsx` (类型定义)

**验收标准**：
- 首屏加载体积减少 40%+
- 所有页面正常懒加载
- 无白屏或加载闪烁

---

### 任务 1.3：SWR 重试优化 ✅
**优先级**：🟡 中
**预期收益**：启动期更平稳
**实施难度**：⭐⭐ 低

**实施步骤**：
1. 修改 `use-groups.tsx` 和 `use-rules.tsx`
2. 监听 core-started 事件
3. core 启动前暂停 SWR

**相关文件**：
- `src/renderer/src/hooks/use-groups.tsx`
- `src/renderer/src/hooks/use-rules.tsx`

**验收标准**：
- 启动时无密集 IPC 调用
- SWR 在 core 启动后正常工作

---

## 阶段 2：中期性能优化（2-4 周）

### 任务 2.1：CI 矩阵收敛 ⏳
**优先级**：🔴 高
**预期收益**：CI 时间 ↓ 30-50%
**实施难度**：⭐⭐⭐ 中

**实施步骤**：
1. 去除 format 维度
2. 在一次 build 中生成多个 target
3. 调整 build 脚本传参

**相关文件**：
- `.github/workflows/build.yml`
- `package.json`

**验收标准**：
- Job 数量从 10-15 降到 5-7
- 所有平台产物正常生成

---

### 任务 2.2：Logs 页优化 ⏳
**优先级**：🟡 中
**预期收益**：后台 CPU 占用降低
**实施难度**：⭐⭐⭐ 中

**实施步骤**：
1. 将监听移到组件 useEffect 内
2. 实现节流批量更新
3. 可选：实现按需订阅

**相关文件**：
- `src/renderer/src/pages/logs.tsx`
- `src/main/core/mihomoApi.ts` (如果实现按需订阅)

**验收标准**：
- 日志页关闭时不接收推送
- UI 更新不卡顿
- 内存占用稳定

---

### 任务 2.3：Connections 页优化 ⏳
**优先级**：🟡 中
**预期收益**：渲染性能 ↑ 50%
**实施难度**：⭐⭐⭐ 中

**实施步骤**：
1. 修复 IPC 监听反复重建
2. 使用 Map 替代 find（O(n²) → O(n)）
3. 单一定时器替代每项定时器

**相关文件**：
- `src/renderer/src/pages/connections.tsx`
- `src/renderer/src/components/connections/connection-item.tsx`

**验收标准**：
- 切换选中态不触发全列表重渲染
- 高连接数时性能稳定

---

### 任务 2.4：WS 重连退避 ⏳
**优先级**：🟢 低
**预期收益**：断连场景更稳定
**实施难度**：⭐⭐ 低

**实施步骤**：
1. 实现指数退避算法
2. 添加 jitter 随机化
3. 设置最大退避时间

**相关文件**：
- `src/main/core/mihomoApi.ts`

**验收标准**：
- 服务不可用时不会密集重连
- 重连成功率提升

---

## 阶段 3：深度优化（4-8 周）

### 任务 3.1：WS 按需开启 ⏳
**优先级**：🟡 中
**预期收益**：后台资源占用 ↓ 50%
**实施难度**：⭐⭐⭐⭐ 高

**实施步骤**：
1. 实现引用计数机制
2. 添加 start/stop API
3. Renderer 按需订阅

**相关文件**：
- `src/main/core/mihomoApi.ts`
- `src/main/core/manager.ts`
- 所有需要 WS 数据的页面组件

**验收标准**：
- 页面关闭时 WS 停止推送
- 页面打开时自动启动
- 资源占用显著降低

---

### 任务 3.2：Monaco 懒加载 ⏳
**优先级**：🟢 低
**预期收益**：内存占用降低
**实施难度**：⭐⭐⭐ 中

**实施步骤**：
1. Monaco Editor 按需加载
2. 配置动态导入
3. 关闭不必要的 schema 请求

**相关文件**：
- `src/renderer/src/components/base/base-editor.tsx`

**验收标准**：
- Monaco 仅在编辑器页面加载
- 初始内存占用降低

---

### 任务 3.3：CI prepare 缓存 ⏳
**优先级**：🟢 低
**预期收益**：节省 2-5 分钟
**实施难度**：⭐⭐⭐ 中

**实施步骤**：
1. 添加 prepared files 缓存
2. 或在 push 验证时跳过 prepare

**相关文件**：
- `.github/workflows/build.yml`
- `scripts/prepare.mjs`

**验收标准**：
- prepare 产物被正确缓存
- CI 时间显著减少

---

## 任务状态

- ✅ 已完成
- ⏳ 进行中
- ⏸️ 待开始
- ❌ 失败/阻塞

---

## 风险评估

### 高风险项
- CI 矩阵收敛：影响所有平台构建，需充分测试
- WS 按需开启：架构改动较大，需 careful 修复

### 中风险项
- 路由懒加载：可能影响现有导航逻辑
- Logs/Connections 优化：需确保功能不受影响

### 低风险项
- CI 依赖缓存：影响范围小
- SWR 重试优化：影响启动阶段

---

## Phase 1 完成记录

**完成时间**：2026-01-11
**Git Commit**：0ecab19

### 已完成任务

✅ **任务 1.1：CI 依赖缓存**
- 添加 `actions/setup-node@v4`，启用 pnpm 缓存
- 使用 `corepack` 固定 pnpm@10.15.0 版本
- 添加 Electron 跨平台缓存
- 验收：通过 Codex 审核确认

✅ **任务 1.2：路由懒加载**
- 14 个页面组件全部使用 `React.lazy()` 动态导入
- 使用 HeroUI `Spinner` 作为 Suspense fallback
- 修正类型导入：`JSX.Element`
- 验收：通过 Codex 审核确认

✅ **任务 1.3：SWR 重试优化**
- 监听 `core-started` 事件，启动前禁用 SWR 重试
- 合并监听器，使用 `removeListener` 避免误删
- 验收：通过 Codex 审核确认

### 修复问题

根据 Codex 审核反馈，修复了以下问题：
1. 路由懒加载：Loading 组件不存在 → 改用 Spinner
2. SWR 优化：removeAllListeners 潜在问题 → 改用 removeListener
3. CI 缓存：
   - package-lock.json 不存在 → 改用 pnpm-lock.yaml
   - pnpm 版本不一致 → 添加 corepack 步骤
   - Windows 缓存路径 → 移除不兼容路径

### 下一步

Phase 2（中期优化）待实施：
- 任务 2.1：CI 矩阵收敛
- 任务 2.2：Logs 页优化
- 任务 2.3：Connections 页优化
- 任务 2.4：WS 重连退避

---

## 总结

本计划包含 9 个主要优化任务，分为 3 个阶段实施。预期最终收益：
- 首屏加载时间 ↓ 40-60%
- CI 时间 ↓ 60%
- 后台资源占用 ↓ 50%
- 渲染性能 ↑ 50%

所有任务完成后，Sparkle 将在性能和用户体验上有显著提升。

**当前进度**：Phase 1 已完成 ✅（3/9 任务完成）
