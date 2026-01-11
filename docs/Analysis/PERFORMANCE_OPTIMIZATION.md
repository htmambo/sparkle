# Sparkle 性能优化分析与建议

> 基于 Codex 全面审核生成，涵盖 CI/CD、代码层面、资源占用等多个维度

---

## 🚀 优化优先级矩阵

| 优先级 | 优化项 | 预期收益 | 实施难度 | 影响范围 |
|--------|--------|----------|----------|----------|
| 🔴 高 | 路由懒加载 | 高 | 中 | 首屏启动 |
| 🔴 高 | CI 矩阵收敛 | 高 | 中 | 构建时间 |
| 🟡 中 | CI 依赖缓存 | 高 | 低 | 构建时间 |
| 🟡 中 | WS 按需开启 | 高 | 高 | 常驻资源 |
| 🟡 中 | Logs 页优化 | 中 | 中 | CPU/内存 |
| 🟡 中 | Connections 页优化 | 中 | 中 | ��染性能 |
| 🟢 低 | Monaco 懒加载 | 中 | 中 | 内存占用 |
| 🟢 低 | CI prepare 缓存 | 高 | 中 | 网络带宽 |

---

## 1. GitHub Actions 工作流优化（CI/CD）

### 🔴 高优先级：矩阵收敛

**问题位置**：`.github/workflows/build.yml:49-67`

**问题描述**：
- `format` 被当作矩阵维度，导致同一 `os+arch` 需要重复构建
- 例如：Windows x64 需要分别构建 7z 和 nsis，两个独立的 job
- 当前矩阵规模：10-15 个 jobs

**优化方案**：
```yaml
# 当前：按 format 维度拆分
- os: windows-latest
  arch: x64
  format: 7z
- os: windows-latest
  arch: x64
  format: nsis

# 优化后：在一个 job 中构建多个 target
- os: windows-latest
  arch: x64
  targets: 7z,nsis
```

**预期收益**：
- CI 时间减少 30-50%
- Runner 资源消耗降低
- 队列等待时间缩短

**实施难度**：⭐⭐⭐ 中

---

### 🟡 中优先级：依赖缓存

**问题位置**：`.github/workflows/build.yml:162-164`

**问题描述**：
- 每个 job 都执行 `npm install -g pnpm`
- 无 pnpm store 缓存
- 无 Electron/electron-builder 缓存

**优化方案**：
```yaml
- name: Setup Node.js and pnpm
  uses: actions/setup-node@v4
  with:
    node-version: '20'
    cache: 'pnpm'

- name: Cache Electron
  uses: actions/cache@v4
  with:
    path: |
      ~/.electron
      ~/Library/Caches/electron
    key: ${{ runner.os }}-electron-${{ hashFiles('package-lock.json') }}
```

**预期收益**：
- 依赖安装时间减少 60-80%
- 网络带宽节省

**实施难度**：⭐⭐ 低

---

### 🟢 低优先级：prepare 缓存策略

**问题位置**：`scripts/prepare.mjs:10`、`scripts/prepare.mjs:22-84`

**问题描述**：
- `prepare.mjs` 每次都从远程下载 mihomo、geoip、geosite 等文件
- 全矩阵下重复下载非常耗时

**优化方案**：
1. **方案 A**：缓存 `node_modules/.temp` 和 `extra/sidecar`
   ```yaml
   - name: Cache Prepared Files
     uses: actions/cache@v4
     with:
       path: |
         node_modules/.temp
         extra/sidecar
       key: prepared-${{ hashFiles('scripts/prepare.mjs') }}
   ```

2. **方案 B**（更激进）：push 验证阶段跳过 prepare
   ```yaml
   - name: Determine and Update Version
     run: |
       if [ "${{ github.event_name }}" != "workflow_dispatch" ]; then
         export SKIP_PREPARE=1
       fi
   ```

**预期收益**：
- Windows/macOS runner 上节省 2-5 分钟
- 网络带宽显著节省

**实施难度**：⭐⭐⭐ 中

---

## 2. React 代码层面性能优化

### 🔴 最高优先级：路由懒加载

**问题位置**：`src/renderer/src/routes/index.tsx:1-15`

**问题描述**：
```typescript
// 当前：所有页面都在启动时加载
import Overview from './pages/overview'
import Logs from './pages/logs'
import Connections from './pages/connections'
import Profiles from './pages/profiles'
// ... 更多页面
```

这会导致：
- 首屏加载所有页面的代码
- 所有页面的模块级副作用立即执行（如 IPC 监听注册）
- Monaco Editor 提前加载（即使未使用）

**优化方案**：
```typescript
import { lazy, Suspense } from 'react'

const Overview = lazy(() => import('./pages/overview'))
const Logs = lazy(() => import('./pages/logs'))
const Connections = lazy(() => import('./pages/connections'))
const Profiles = lazy(() => import('./pages/profiles'))

// 在路由中使用 Suspense
<Suspense fallback={<Loading />}>
  <Routes>
    <Route path="/logs" element={<Logs />} />
  </Routes>
</Suspense>
```

**预期收益**：
- 首屏加载体积减少 40-60%
- 启动时间减少 30-50%
- 初始内存占用降低

**实施难度**：⭐⭐⭐ 中

---

### 🟡 中优先级：Logs 页优化

**问题位置**：`src/renderer/src/pages/logs.tsx:26`

**问题描述**：
```typescript
// 模块顶层注册监听，只要 routes 被引入就会执行
mihomoLogs((log) => {
  setLogs((a) => [...a, log])
  if (a.length > 500) a.shift()
}, () => {})
```

**问题分析**：
- 监听在模块顶层，应用启动时就注册
- 每条日志触发数组拷贝（最多 500 条）
- 即使用户未打开日志页也在接收推送

**优化方案**：
1. **方案 A**：将监听移到组件内部
   ```typescript
   useEffect(() => {
     const unsubscribe = mihomoLogs((log) => {
       setLogs((a) => {
         const newArr = [...a, log]
         if (newArr.length > 500) newArr.shift()
         return newArr
       })
     }, () => {})

     return () => unsubscribe()
   }, [])
   ```

2. **方案 B**：节流 UI 更新
   ```typescript
   const logBuffer = useRef([])
   const flushLogs = useCallback(() => {
     setLogs(prev => [...prev, ...logBuffer.current])
     logBuffer.current = []
   }, [])

   // 每 100ms 批量更新
   useInterval(flushLogs, 100)
   ```

3. **方案 C**（最激进）：按需订阅
   - 主进程提供 `startLogs()` / `stopLogs()` API
   - 组件挂载时启动，卸载时停止

**预期收益**：
- 后台 CPU 占用降低
- 内存 GC 压力减小
- 无意义的 IPC 推送减少

**实施难度**：⭐⭐⭐ 中

---

### 🟡 中优先级：Connections 页优化

**问题位置**：
- `src/renderer/src/pages/connections.tsx:216-221`
- `src/renderer/src/components/connections/connection-item.tsx:51-57`
- `src/renderer/src/components/connections/connection-item.tsx:168`

**问题 A：IPC 监听反复重建**
```typescript
useEffect(() => {
  ipcRenderer.on('connectionsUpdated', handler)
  return () => {
    ipcRenderer.removeAllListeners('connectionsUpdated')
  }
}, [filteredConnections, sortMethod]) // 依赖太多，频繁重建
```

**优化方案**：
```typescript
useEffect(() => {
  const handler = (_, connections) => {
    setAllConnections(connections)
  }

  ipcRenderer.on('connectionsUpdated', handler)

  return () => {
    // 不要用 removeAllListeners，只移除当前监听
    ipcRenderer.removeListener('connectionsUpdated', handler)
  }
}, []) // 空依赖，只注册一次
```

**问题 B：O(n²) 查找**
```typescript
// 每次更新都要遍历查找
const activeConns = allConnections.filter((conn) =>
  activeConns.find((c) => c.id === conn.id)
)
```

**优化方案**：
```typescript
// 使用 Map 做关联，O(n) 复杂度
const activeMap = useMemo(
  () => new Map(activeConns.map(c => [c.id, c])),
  [activeConns]
)
const activeConnections = allConnections.filter(conn =>
  activeMap.has(conn.id)
)
```

**问题 C：每个连接一个定时器**
```typescript
// connection-item.tsx
useEffect(() => {
  const timer = setInterval(() => {
    setFromNow(dayjs().to(conn.meta.createdAt))
  }, 1000)
  return () => clearInterval(timer)
}, [])
```

**优化方案**：
```typescript
// 在列表层使用单一 timer
const ConnectionsList = () => {
  const [now, setNow] = useState(Date.now())

  useInterval(() => setNow(Date.now()), 1000)

  return connections.map(conn => (
    <ConnectionItem
      key={conn.id}
      conn={conn}
      now={now} // 传入统一的时间戳
    />
  ))
}
```

**预期收益**：
- 连接列表刷新性能提升
- 高连接数时 CPU 占用降低
- 定时器数量从 n 降到 1

**实施难度**：⭐⭐⭐ 中

---

## 3. WebSocket / IPC 优化

### 🟡 中优先级：WS 按需开启

**问题位置**：`src/main/core/manager.ts:261-264`

**问题描述**：
```typescript
// 核心启动后默认开启所有 WS
startMihomoTraffic()   // 即使未打开流量页
startMihomoMemory()    // 即使未打开内存页
startMihomoLogs()      // 即使未打开日志页
startMihomoConnections() // 即使未打开连接页
```

这会导致：
- 后台持续 JSON.parse 处理
- 持续的 IPC send 到 renderer
- 即使 renderer 不需要数据也在推送

**优化方案**：

**步骤 1**：添加引用计数
```typescript
// src/main/core/mihomoApi.ts
const wsSubscribers = {
  traffic: 0,
  memory: 0,
  logs: 0,
  connections: 0
}

export const startMihomoTraffic = async () => {
  wsSubscribers.traffic++
  if (wsSubscribers.traffic === 1) {
    // 真正启动
    await mihomoTraffic()
  }
}

export const stopMihomoTraffic = () => {
  wsSubscribers.traffic--
  if (wsSubscribers.traffic === 0) {
    // 停止 WS 并清理
    trafficWs?.close()
    trafficWs = null
  }
}
```

**步骤 2**：renderer 按需订阅
```typescript
// src/renderer/src/pages/logs.tsx
useEffect(() => {
  window.electron.ipcRenderer.send('startMihomoLogs')

  return () => {
    window.electron.ipcRenderer.send('stopMihomoLogs')
  }
}, [])
```

**预期收益**：
- 后台 CPU 占用降低 30-50%
- IPC 消息频率降低
- 内存占用减小

**实施难度**：⭐⭐⭐⭐ 高（需要 main/renderer 协议改造）

---

### 🟢 低优先级：WS 重连退避

**问题位置**：`src/main/core/mihomoApi.ts:255-259`

**问题描述**：
```typescript
mihomoTrafficWs.onclose = (): void => {
  if (trafficRetry && !trafficStopped) {
    trafficRetry--
    mihomoTraffic() // 立即递归重连
  }
}
```

服务不可用时会形成密集重连。

**优化方案**：
```typescript
const getBackoff = (retryCount: number) => {
  // 指数退避：1s, 2s, 4s, 8s, 16s, 最大 30s
  return Math.min(1000 * Math.pow(2, retryCount), 30000)
}

mihomoTrafficWs.onclose = (): void => {
  if (trafficRetry && !trafficStopped) {
    trafficRetry--
    const delay = getBackoff(10 - trafficRetry)

    setTimeout(() => {
      if (!trafficStopped) mihomoTraffic()
    }, delay + Math.random() * 1000) // 加 jitter
  }
}
```

**预期收益**：
- 断连场景更稳定
- 减少无效重连
- 降低 CPU/网络压力

**实施难度**：⭐⭐ 低

---

## 4. 其他优化建议

### SWR 重试策略优化

**问题位置**：
- `src/renderer/src/hooks/use-groups.tsx:13-16`
- `src/renderer/src/hooks/use-rules.tsx:13-16`

**问题描述**：
```typescript
errorRetryInterval: 200   // 200ms 重试间隔
errorRetryCount: 10       // 最多重试 10 次
```

Core 未启动时会产生密集 IPC 调用。

**优化方案**：
```typescript
// 监听 core-started 事件
const [coreStarted, setCoreStarted] = useState(false)

useEffect(() => {
  const handler = () => setCoreStarted(true)
  window.electron.ipcRenderer.on('core-started', handler)
  return () => window.electron.ipcRenderer.removeListener('core-started', handler)
}, [])

// core 启动后才开启 SWR
const swrConfig = coreStarted ? {
  errorRetryInterval: 200,
  errorRetryCount: 10
} : {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  errorRetryCount: 0
}
```

**实施难度**：⭐⭐ 低

---

## 5. 实施路线图

### 阶段 1：快速见效（1-2 周）
1. ✅ CI 依赖缓存
2. ✅ 路由懒加载
3. ✅ SWR 重试优化

**预期收益**：
- 首屏加载时间 ↓ 40%
- CI 时间 ↓ 40%

### 阶段 2：中期优化（2-4 周）
1. ✅ CI 矩阵收敛
2. ✅ Logs 页优化
3. ✅ Connections 页优化
4. ✅ WS 重连退避

**预期收益**：
- CI 时间 ↓ 60%
- 后台 CPU 占用 ↓ 30%
- 渲染性能 ↑ 50%

### 阶段 3：深度优化（4-8 周）
1. ✅ WS 按需开启
2. ✅ Monaco 懒加载
3. ✅ CI prepare 缓存

**预期收益**：
- 常驻资源占用 ↓ 50%
- 用户体验显著提升

---

## 6. 性能监控建议

### 添加性能指标收集

**构建分析**：
```bash
# 添加到 package.json
"scripts": {
  "build:analyze": "vite build --mode analyze"
}
```

**运行时监控**：
```typescript
// 添加性能埋点
performance.mark('app-start')
performance.mark('first-render')
performance.measure('startup', 'app-start', 'first-render')
```

**CI 性能基准**：
- 记录每次构建的耗时
- 设置性能回归告警

---

## 总结

根据 Codex 分析，Sparkle 项目在以下方面有较大优化空间：

✅ **已修复**：
- Monaco 内存泄漏
- WebSocket stop 标志

⚠️ **建议优先处理**（高 ROI）：
1. 路由懒加载
2. CI 依赖缓存
3. CI 矩阵收敛
4. Logs/Connections 页优化

🎯 **长期优化**（工程量大但收益高）：
1. WS 按需开启
2. 完整的性能监控系统

所有优化建议均基于 Codex 的静态分析，建议逐步实施并测试验证。
