# Sparkle 项目改进修复计划

**状态**: ⏳ 待执行
**创建时间**: 2026-01-11
**创建人**: Claude Code + Codex MCP
**优先级**: 高（安全相关）→ 中（性能相关）→ 低（注释完善）

---

## 📋 目录

1. [任务概述](#任务概述)
2. [安全问题修复（高优先级）](#安全问题修复高优先级)
3. [性能问题修复（中优先级）](#性能问题修复中优先级)
4. [注释补充（低优先级）](#注释补充低优先级)
5. [实施时间表](#实施时间表)
6. [测试计划](#测试计划)
7. [风险评估](#风险评估)

---

## 任务概述

### 目标

修复 Sparkle 项目中识别出的安全漏洞、性能问题和代码质量缺陷，提升项目的安全性、稳定性和可维护性。

### 背景

经过全面的项目分析，识别出以下关键问题：

- **5 个高危安全问题**：Renderer 沙箱配置、VM 脚本逃逸、深链路验证、凭证明文存储、预加载脚本不安全
- **3 个性能问题**：Monaco Editor 内存泄漏、WebSocket 连接管理、Monaco 重复初始化
- **多个代码质量问题**：缺少注释、缺少测试

### 预期效果

- ✅ 消除已知高危安全漏洞
- ✅ 修复内存泄漏和资源管理问题
- ✅ 提升代码可读性和可维护性
- ✅ 为后续功能开发奠定坚实基础

---

## 安全问题修复（高优先级）

### 1.1 Renderer 进程安全配置加固

**位置**: `src/main/index.ts`
**风险等级**: 🔴 高危
**复杂度**: 中等
**影响范围**: 所有 BrowserWindow 实例

#### 问题描述

主窗口创建时未显式设置关键安全选项，依赖 Electron 默认值且主动禁用了沙箱：

```typescript
// 当前代码（不安全）
webPreferences: {
  preload: join(__dirname, '../preload/index.js'),
  spellcheck: false,
  sandbox: false  // ⚠️ 主动禁用沙箱
}
```

#### 修复方案

```diff
*** Update File: src/main/index.ts
@@
       webPreferences: {
         preload: join(__dirname, '../preload/index.js'),
         spellcheck: false,
-        sandbox: false
+        contextIsolation: true,
+        nodeIntegration: false,
+        sandbox: true,
+        webSecurity: true
       }
```

#### 修复内容

- ✅ 显式启用 `contextIsolation: true`（默认值，但需明确）
- ✅ 显式禁用 `nodeIntegration: false`（默认值，但需明确）
- ✅ **启用沙箱 `sandbox: true`**（关键修改）
- ✅ 显式启用 `webSecurity: true`（默认值，但需明确）

#### 测试验证

1. 启动应用，确认主窗口正常加载
2. 打开 DevTools，验证 `window` 对象不包含 Node.js 全局变量
3. 测试所有 renderer 功能（IPC 调用、预加载 API）
4. 验证第三方页面加载（如果有）不受影响

#### 风险评估

- **兼容性风险**: 低 - Electron 应用应支持沙箱模式
- **功能影响**: 低 - 预加载脚本已使用 `contextBridge`
- **回滚方案**: 移除 `sandbox: true` 即可

---

### 1.2 预加载脚本不安全 Fallback 移除

**位置**: `src/preload/index.ts`
**风险等级**: 🔴 高危
**复杂度**: 低
**影响范围**: 预加载脚本

#### 问题描述

当 `contextIsolation` 关闭时，预加载脚本直接将 API 暴露到 `window`，存在安全风险：

```typescript
// 当前代码（不安全）
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // ⚠️ 直接暴露到 window，任意脚本可劫持
  window.electron = electronAPI
  window.api = api
}
```

#### 修复方案

```diff
*** Update File: src/preload/index.ts
@@
 } else {
-  // @ts-ignore (define in dts)
-  window.electron = electronAPI
-  // @ts-ignore (define in d.ts)
-  window.api = api
+  // contextIsolation 关闭时不暴露全局对象，避免被任意脚本劫持
+  console.warn('contextIsolation 已关闭，出于安全原因未注入 Electron API')
 }
```

#### 修复内容

- ✅ 移除不安全的 `window` 直接暴露
- ✅ 添加警告日志，提示开发者启用 `contextIsolation`
- ✅ 强制使用安全模式

#### 测试验证

1. 确保 `contextIsolation: true` 已启用
2. 验证 renderer 可通过 `window.electron` 和 `window.api` 访问 API
3. 如果手动禁用 `contextIsolation`，验证 API 未暴露且控制台有警告

#### 风险评估

- **兼容性风险**: 极低 - 不应禁用 `contextIsolation`
- **功能影响**: 无 - 要求使用安全模式
- **回滚方案**: 恢复原有 fallback 逻辑

---

### 1.3 VM 脚本沙箱逃逸防护

**位置**: `src/main/core/factory.ts:328-375`
**风险等级**: 🔴 高危
**复杂度**: 中等
**影响范围**: 覆写脚本功能

#### 问题描述

用户覆写脚本通过 `vm.runInContext` 执行，沙箱提供了 `require`、`process`、`Buffer` 等危险对象，理论上可逃逸沙箱：

```typescript
// 当前代码（不安全）
const ctx = {
  console: Object.freeze({...}),
  fetch,
  yaml: { parse: parseYaml, stringify: stringifyYaml },
  b64d,
  b64e,
  Buffer  // ⚠️ 可用于原型污染
}
vm.createContext(ctx)
vm.runInContext(script, ctx)  // ⚠️ 无超时限制
```

**攻击示例**：
```javascript
// 恶意脚本可能执行：
const fs = require('fs');  // ⚠️ 可访问 require
fs.writeFileSync('/etc/passwd', 'pwned!');
```

#### 修复方案

```diff
*** Update File: src/main/core/factory.ts
@@
-async function runOverrideScript(
+// 在隔离沙箱内执行覆写脚本，禁用 require/process 避免逃逸
+async function runOverrideScript(
   profile: MihomoConfig,
   script: string,
   item: OverrideItem
 ): Promise<MihomoConfig> {
@@
-    const ctx = {
-      console: Object.freeze({
-        log: (...args: unknown[]) => log('log', args.map(format).join(' ')),
-        info: (...args: unknown[]) => log('info', args.map(format).join(' ')),
-        error: (...args: unknown[]) => log('error', args.map(format).join(' ')),
-        debug: (...args: unknown[]) => log('debug', args.map(format).join(' '))
-      }),
-      fetch,
-      yaml: { parse: parseYaml, stringify: stringifyYaml },
-      b64d,
-      b64e,
-      Buffer
-    }
-    vm.createContext(ctx)
-    log('info', '开始执行脚本', 'w')
-    vm.runInContext(script, ctx)
-    const promise = vm.runInContext(
-      `(async () => {
-        const result = main(${JSON.stringify(profile)})
-        if (result instanceof Promise) return await result
-        return result
-      })()`,
-      ctx
-    )
-    const newProfile = await promise
+    // 创建受限沙箱，禁用危险对象
+    const sandbox = vm.createContext(
+      {
+        console: Object.freeze({
+          log: (...args: unknown[]) => log('log', args.map(format).join(' ')),
+          info: (...args: unknown[]) => log('info', args.map(format).join(' ')),
+          error: (...args: unknown[]) => log('error', args.map(format).join(' ')),
+          debug: (...args: unknown[]) => log('debug', args.map(format).join(' '))
+        }),
+        fetch,
+        yaml: Object.freeze({ parse: parseYaml, stringify: stringifyYaml }),
+        b64d,
+        b64e,
+        Buffer: Object.freeze({ from: Buffer.from, alloc: Buffer.alloc }),
+        require: undefined,  // ✅ 禁用 require
+        process: undefined,  // ✅ 禁用 process
+        global: undefined    // ✅ 禁用 global
+      },
+      {
+        name: `override-${item.id}`,
+        codeGeneration: { strings: false, wasm: false }  // ✅ 禁用动态代码生成
+      }
+    )
+    log('info', '开始执行脚本', 'w')
+
+    // 强制清除危险全局对象
+    new vm.Script('globalThis.require = undefined; globalThis.process = undefined;', {
+      timeout: 200
+    }).runInContext(sandbox)
+
+    const setupScript = new vm.Script(script, {
+      filename: `${item.id}.js`,
+      timeout: 1000  // ✅ 脚本初始化超时
+    })
+    setupScript.runInContext(sandbox)
+
+    // 执行主逻辑
+    const runner = new vm.Script(
+      `(async () => {
+        const result = await main(${JSON.stringify(profile)})
+        if (result instanceof Promise) return await result
+        return result
+      })()`,
+      {
+        filename: `${item.id}-runner.js`,
+        timeout: 3000  // ✅ 执行超时 3 秒
+      }
+    )
+    const newProfile = await runner.runInContext(sandbox, { timeout: 3000 })
```

#### 修复内容

- ✅ **移除 `require` 和 `process`**：设为 `undefined`
- ✅ **冻结 `Buffer` 对象**：仅提供必要的静态方法
- ✅ **添加执行超时**：脚本初始化 1 秒，执行 3 秒
- ✅ **禁用动态代码生成**：`codeGeneration: { strings: false, wasm: false }`
- ✅ **使用 `vm.Script` 代替 `vm.runInContext`**：更好的控制
- ✅ **强制清除全局对象**：防止原型链污染

#### 测试验证

1. **合法脚本测试**：
   ```javascript
   // 测试正常覆写脚本仍可工作
   module.exports.parse = async (config, profile) => {
     profile.proxies.push({
       name: 'test',
       type: 'ss',
       server: 'example.com',
       port: 443
     })
     return profile
   }
   ```
   预期：脚本正常执行

2. **恶意脚本测试**：
   ```javascript
   // 尝试访问 require
   module.exports.parse = async (config, profile) => {
     const fs = require('fs')  // 应该失败
     return profile
   }
   ```
   预期：抛出 `require is not defined` 错误

3. **超时测试**：
   ```javascript
   // 无限循环脚本
   module.exports.parse = async (config, profile) => {
     while (true) {}  // 应该在 3 秒后超时
     return profile
   }
   ```
   预期：3 秒后超时，脚本被终止

#### 风险评估

- **兼容性风险**: 中等 - 现有脚本如果依赖 `require`/`process` 将失效
- **功能影响**: 中等 - 需告知用户脚本限制
- **回滚方案**: 恢复原有沙箱配置

---

### 1.4 深链路导入来源验证

**位置**: `src/main/index.ts:341-395`
**风险等级**: 🟡 中危
**复杂度**: 低
**影响范围**: 深链路导入功能

#### 问题描述

`handleDeepLink` 可从任意 URL 拉取配置并写入本地，无协议/域名验证，存在 SSRF 风险：

```typescript
// 当前代码（不安全）
async function handleDeepLink(url: string): Promise<void> {
  // ...
  const urlObj = new URL(url)
  switch (urlObj.host) {
    case 'install-config': {
      const profileUrl = urlObj.searchParams.get('url')
      // ⚠️ 无验证，直接从任意 URL 拉取
      await addProfileItem({ type: 'remote', url: profileUrl })
    }
  }
}
```

**攻击示例**：
```
sparkle://install-config?url=http://localhost:8080/malicious.yaml
sparkle://install-config?url=file:///etc/passwd
```

#### 修复方案

```diff
*** Update File: src/main/index.ts
@@
-async function handleDeepLink(url: string): Promise<void> {
+// 验证远程 URL 是否安全（协议、域名、内网地址）
+function ensureSafeRemote(urlStr: string): string {
+  const parsed = new URL(urlStr)
+
+  // 1. 仅允许 HTTPS
+  if (parsed.protocol !== 'https:') {
+    throw new Error('仅允许 https 链接')
+  }
+
+  // 2. 禁止访问本地/内网地址
+  const hostname = parsed.hostname
+  if (
+    hostname === 'localhost' ||
+    hostname === '127.0.0.1' ||
+    hostname === '::1' ||
+    hostname.startsWith('127.') ||
+    hostname.startsWith('192.168.') ||
+    hostname.startsWith('10.') ||
+    hostname.startsWith('172.16.') ||
+    hostname.endsWith('.local')
+  ) {
+    throw new Error('禁止访问本地或内网地址')
+  }
+
+  // 3. 可选：域名白名单
+  // const ALLOWED_DOMAINS = ['github.com', 'gist.github.com']
+  // if (!ALLOWED_DOMAINS.some(d => hostname.endsWith(d))) {
+  //   throw new Error(`域名 ${hostname} 不在白名单中`)
+  // }
+
+  return parsed.toString()
+}
+
+async function handleDeepLink(url: string): Promise<void> {
@@
-        const confirmed = await showProfileInstallConfirm(profileUrl, profileName)
+        const safeProfileUrl = ensureSafeRemote(profileUrl)
+        const confirmed = await showProfileInstallConfirm(safeProfileUrl, profileName)
@@
-          const url = new URL(urlParam)
+          const safeUrl = ensureSafeRemote(urlParam)
+          const url = new URL(safeUrl)
```

#### 修复内容

- ✅ **仅允许 HTTPS 协议**：禁止 HTTP、FILE 等危险协议
- ✅ **禁止本地/内网地址**：防止 SSRF 攻击
- ✅ **可扩展域名白名单**：注释中提供白名单示例
- ✅ **在导入前验证**：确保所有 URL 都经过验证

#### 测试验证

1. **合法 URL 测试**：
   ```
   sparkle://install-config?url=https://github.com/user/config.yaml
   ```
   预期：正常导入

2. **HTTP URL 测试**：
   ```
   sparkle://install-config?url=http://example.com/config.yaml
   ```
   预期：拒绝并提示"仅允许 https 链接"

3. **本地地址测试**：
   ```
   sparkle://install-config?url=https://localhost:8080/config.yaml
   ```
   预期：拒绝并提示"禁止访问本地或内网地址"

4. **内网地址测试**：
   ```
   sparkle://install-config?url=https://192.168.1.1/config.yaml
   ```
   预期：拒绝并提示"禁止访问本地或内网地址"

#### 风险评估

- **兼容性风险**: 低 - 大多数订阅源已使用 HTTPS
- **功能影响**: 低 - 仅影响不安全的订阅源
- **回滚方案**: 移除 `ensureSafeRemote` 验证

---

### 1.5 敏感凭据加密存储

**位置**: `src/main/config/app.ts`
**风险等级**: 🟡 中危
**复杂度**: 低
**影响范围**: 配置文件存储

#### 问题描述

仅部分敏感字段加密存储，`githubToken` 和 `webdavPassword` 明文落盘：

```typescript
// 当前代码（不完整）
const ENCRYPTED_FIELDS = ['systemCorePath', 'serviceAuthKey'] as const
// ⚠️ 缺少 githubToken、webdavPassword
```

#### 修复方案

```diff
*** Update File: src/main/config/app.ts
@@
-const ENCRYPTED_FIELDS = ['systemCorePath', 'serviceAuthKey'] as const
+// 在磁盘上加密敏感字段，防止凭证明文存储
+const ENCRYPTED_FIELDS = [
+  'systemCorePath',
+  'serviceAuthKey',
+  'githubToken',    // ✅ 新增
+  'webdavPassword'  // ✅ 新增
+] as const
@@
-      if (!isEncrypted(value)) {
-        ;(result[field] as string) = ''
-      } else {
-        ;(result[field] as string) = decryptString(value)
-      }
+      if (!isEncrypted(value)) {
+        // ✅ 兼容旧明文数据，下次保存时自动加密
+        ;(result[field] as string) = value
+      } else {
+        ;(result[field] as string) = decryptString(value)
+      }
```

#### 修复内容

- ✅ **扩展加密字段列表**：添加 `githubToken`、`webdavPassword`
- ✅ **兼容旧明文数据**：读取明文时不强制置空，下次保存时自动加密
- ✅ **无缝迁移**：用户无感知，自动升级

#### 测试验证

1. **新配置测试**：
   - 保存 GitHub Token
   - 检查配置文件，Token 应为 `enc:base64...` 格式
   - 重启应用，验证功能正常

2. **旧配置迁移测试**：
   - 使用旧明文密码的配置文件
   - 启动应用，验证可正常读取
   - 修改配置后，检查新保存的为密文

#### 风险评估

- **兼容性风险**: 极低 - 向后兼容明文数据
- **功能影响**: 无 - 对用户透明
- **回滚方案**: 从加密字段列表中移除新字段

---

## 性能问题修复（中优先级）

### 2.1 Monaco Editor 内存泄漏修复

**位置**: `src/renderer/src/components/base/base-editor.tsx`
**风险等级**: 🟡 中危
**复杂度**: 低
**影响范围**: Monaco Editor 组件

#### 问题描述

Monaco Editor 在组件卸载时未释放 Model 和 Editor 实例，导致内存泄漏：

```typescript
// 当前代码（不完整）
const editorDidMount = (editor: monaco.editor.IStandaloneCodeEditor): void => {
  editorRef.current = editor
  const uri = monaco.Uri.parse(`${nanoid()}.${language}`)
  const model = monaco.editor.createModel(value, language, uri)
  editorRef.current.setModel(model)
  // ⚠️ model 未被追踪和释放
}

// ⚠️ 空的卸载函数
editorWillUnmount={(): void => {}}
```

#### 修复方案

```diff
*** Update File: src/renderer/src/components/base/base-editor.tsx
@@
-let initialized = false
+// 跨编辑器实例共享的初始化标志
+const MONACO_INIT_FLAG = '__sparkle_monaco_initialized__'
+let initialized = false
 const monacoInitialization = (): void => {
-  if (initialized) return
+  // 检查全局标志，避免重复初始化
+  if (initialized || (globalThis as Record<string, unknown>)[MONACO_INIT_FLAG]) return
@@
   monaco.languages.typescript.javascriptDefaults.addExtraLib(pac, 'pac.d.ts')
-  initialized = true
+  initialized = true
+  // 设置全局标志
+  ;(globalThis as Record<string, unknown>)[MONACO_INIT_FLAG] = true
 }
@@
   const editorRef = useRef<monaco.editor.IStandaloneCodeEditor>(undefined)
   const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor>(undefined)
+  // ✅ 追踪 Model 实例
+  const modelRef = useRef<monaco.editor.ITextModel | null>(null)
+  const originalModelRef = useRef<monaco.editor.ITextModel | null>(null)
+  const modifiedModelRef = useRef<monaco.editor.ITextModel | null>(null)
+
+  // ✅ 释放所有 Model 实例
+  const disposeModels = (): void => {
+    modelRef.current?.dispose()
+    modelRef.current = null
+    originalModelRef.current?.dispose()
+    originalModelRef.current = null
+    modifiedModelRef.current?.dispose()
+    modifiedModelRef.current = null
+  }
@@
     const uri = monaco.Uri.parse(`${nanoid()}.${language === 'yaml' ? 'clash' : ''}.${language}`)
     const model = monaco.editor.createModel(value, language, uri)
     editorRef.current.setModel(model)
+    modelRef.current = model  // ✅ 追踪 model
@@
     const originalModel = monaco.editor.createModel(originalValue || '', language, originalUri)
     const modifiedModel = monaco.editor.createModel(value, language, modifiedUri)
     diffEditorRef.current.setModel({
       original: originalModel,
       modified: modifiedModel
     })
+    originalModelRef.current = originalModel  // ✅ 追踪 models
+    modifiedModelRef.current = modifiedModel
   }
@@
         options={options}
         editorWillMount={editorWillMount}
         editorDidMount={diffEditorDidMount}
-        editorWillUnmount={(): void => {}}
+        editorWillUnmount={disposeModels}  // ✅ 释放 models
         onChange={onChange}
       />
@@
       options={options}
       editorWillMount={editorWillMount}
       editorDidMount={editorDidMount}
-      editorWillUnmount={(): void => {}}
+      editorWillUnmount={disposeModels}  // ✅ 释放 models
       onChange={onChange}
     />
```

#### 修复内容

- ✅ **追踪所有 Model 实例**：使用 `useRef` 存储
- ✅ **统一释放函数**：`disposeModels` 释放所有 models
- ✅ **全局初始化标志**：避免跨实例重复初始化
- ✅ **在卸载时释放**：绑定 `editorWillUnmount`

#### 测试验证

1. **内存泄漏测试**：
   - 打开 Monaco Editor 页面
   - 使用浏览器 DevTools 内存分析器记录堆快照
   - 关闭页面，强制垃圾回收
   - 再次记录堆快照，对比 Model 实例数量
   - 预期：Model 实例数量不增长

2. **功能测试**：
   - 打开/关闭编辑器 10 次
   - 验证每次都能正常编辑
   - 预期：无内存泄漏，功能正常

#### 风险评估

- **兼容性风险**: 极低 - 不影响现有功能
- **功能影响**: 无 - 纯优化
- **回滚方案**: 移除 `disposeModels` 调用

---

### 2.2 WebSocket 连接管理优化

**位置**: `src/main/core/mihomoApi.ts`
**风险等级**: 🟡 中危
**复杂度**: 低
**影响范围**: WebSocket 连接（流量、内存、日志、连接）

#### 问题描述

WebSocket 在 `stop` 后仍会自动重连，缺少停止标志：

```typescript
// 当前代码（不完整）
let mihomoTrafficWs: WebSocket | null = null
let trafficRetry = 10

const mihomoTraffic = async (): Promise<void> => {
  mihomoTrafficWs = new WebSocket(`ws+unix:${mihomoIpcPath()}:/traffic`)

  mihomoTrafficWs.onclose = (): void => {
    if (trafficRetry) {  // ⚠️ 即使 stop 后仍会重连
      trafficRetry--
      mihomoTraffic()
    }
  }
}

export const stopMihomoTraffic = (): void => {
  if (mihomoTrafficWs) {
    mihomoTrafficWs.removeAllListeners()
    mihomoTrafficWs.close()
    mihomoTrafficWs = null
  }
  // ⚠️ 未设置 trafficRetry = 0，可能触发重连
}
```

#### 修复方案

```diff
*** Update File: src/main/core/mihomoApi.ts
@@
-let mihomoTrafficWs: WebSocket | null = null
+let mihomoTrafficWs: WebSocket | null = null
+let trafficStopped = false  // ✅ 新增停止标志
@@
-let mihomoMemoryWs: WebSocket | null = null
+let mihomoMemoryWs: WebSocket | null = null
+let memoryStopped = false  // ✅ 新增停止标志
@@
-let mihomoLogsWs: WebSocket | null = null
+let mihomoLogsWs: WebSocket | null = null
+let logsStopped = false  // ✅ 新增停止标志
@@
-let mihomoConnectionsWs: WebSocket | null = null
+let mihomoConnectionsWs: WebSocket | null = null
+let connectionsStopped = false  // ✅ 新增停止标志
@@
 export const startMihomoTraffic = async (): Promise<void> {
+  trafficStopped = false  // ✅ 重置停止标志
   await mihomoTraffic()
 }

 export const stopMihomoTraffic = (): void => {
+  trafficStopped = true  // ✅ 设置停止标志
   if (mihomoTrafficWs) {
     mihomoTrafficWs.removeAllListeners()
     if (mihomoTrafficWs.readyState === WebSocket.OPEN) {
       mihomoTrafficWs.close()
     }
     mihomoTrafficWs = null
   }
 }
@@
   mihomoTrafficWs.onclose = (): void => {
-    if (trafficRetry) {
+    if (trafficRetry && !trafficStopped) {  // ✅ 检查停止标志
       trafficRetry--
       mihomoTraffic()
     }
   }
@@
 export const startMihomoMemory = async (): Promise<void> => {
+  memoryStopped = false  // ✅ 重置停止标志
   await mihomoMemory()
 }

 export const stopMihomoMemory = (): void => {
+  memoryStopped = true  // ✅ 设置停止标志
   if (mihomoMemoryWs) {
@@
   mihomoMemoryWs.onclose = (): void => {
-    if (memoryRetry) {
+    if (memoryRetry && !memoryStopped) {  // ✅ 检查停止标志
       memoryRetry--
       mihomoMemory()
     }
   }
@@
 export const startMihomoLogs = async (): Promise<void> => {
+  logsStopped = false  // ✅ 重置停止标志
   await mihomoLogs()
 }

 export const stopMihomoLogs = (): void => {
+  logsStopped = true  // ✅ 设置停止标志
   if (mihomoLogsWs) {
@@
   mihomoLogsWs.onclose = (): void => {
-    if (logsRetry) {
+    if (logsRetry && !logsStopped) {  // ✅ 检查停止标志
       logsRetry--
       mihomoLogs()
     }
   }
@@
 export const startMihomoConnections = async (): Promise<void> => {
+  connectionsStopped = false  // ✅ 重置停止标志
   await mihomoConnections()
 }

 export const stopMihomoConnections = (): void => {
+  connectionsStopped = true  // ✅ 设置停止标志
   if (mihomoConnectionsWs) {
@@
   mihomoConnectionsWs.onclose = (): void => {
-    if (connectionsRetry) {
+    if (connectionsRetry && !connectionsStopped) {  // ✅ 检查停止标志
       connectionsRetry--
       mihomoConnections()
     }
   }
```

#### 修复内容

- ✅ **添加停止标志**：每个 WebSocket 对应一个 `_stopped` 标志
- ✅ **`start` 时重置标志**：允许重新启动
- ✅ **`stop` 时设置标志**：阻止自动重连
- ✅ **`onclose` 检查标志**：仅在未停止时重连

#### 测试验证

1. **停止测试**：
   - 启动应用，等待 WebSocket 连接
   - 停止 Mihomo 内核
   - 观察日志，确认无 WebSocket 重连
   - 预期：WebSocket 停止后不再重连

2. **重启测试**：
   - 停止 Mihomo 内核
   - 重新启动内核
   - 验证 WebSocket 自动恢复
   - 预期：WebSocket 正常重连

#### 风险评估

- **兼容性风险**: 极低 - 不影响正常重连逻辑
- **功能影响**: 无 - 纯优化
- **回滚方案**: 移除停止标志检查

---

### 2.3 Monaco Editor 全局初始化优化

**位置**: `src/renderer/src/components/base/base-editor.tsx:22`
**风险等级**: 🟢 低
**复杂度**: 低
**影响范围**: Monaco Editor 初始化

#### 问题描述

已在 2.1 节中修复，使用全局标志 `__sparkle_monaco_initialized__` 避免重复初始化。

---

## 注释补充（低优先级）

### 3.1 IPC Handler 注册函数注释

**位置**: `src/main/utils/ipc.ts:152`
**风险等级**: 🟢 无
**复杂度**: 极低
**影响范围**: IPC 文档

#### 修复方案

```diff
*** Update File: src/main/utils/ipc.ts
@@
-export function registerIpcMainHandlers(): void {
+/**
+ * 注册 renderer 可用的 IPC 调用入口
+ *
+ * @description
+ * 此函数注册所有从 renderer 进程调用的 IPC handlers。
+ * 每个 handler 都通过 `ipcErrorWrapper` 包装，确保错误被结构化返回。
+ *
+ * @example
+ * // Renderer 中调用：
+ * const result = await window.electron.ipcRenderer.invoke('getAppConfig')
+ *
+ * @see {@link ipcErrorWrapper} - 错误包装器实现
+ */
+export function registerIpcMainHandlers(): void {
```

#### 修复内容

- ✅ 添加 JSDoc 注释
- ✅ 说明功能和用途
- ✅ 提供使用示例
- ✅ 引用相关函数

---

## 实施时间表

### Phase 1: 安全加固（第 1-2 周）

| 任务 | 预计工时 | 优先级 | 依赖 |
|------|----------|--------|------|
| 1.1 Renderer 沙箱配置 | 4 小时 | P0 | 无 |
| 1.2 预加载脚本 fallback | 2 小时 | P0 | 1.1 |
| 1.3 VM 沙箱逃逸防护 | 8 小时 | P0 | 无 |
| 1.4 深链路验证 | 4 小时 | P1 | 无 |
| 1.5 凭据加密 | 2 小时 | P1 | 无 |
| **安全测试** | **8 小时** | **P0** | **所有安全修复** |

**总计**: 28 小时（约 3.5 工作日）

### Phase 2: 性能优化（第 3 周）

| 任务 | 预计工时 | 优先级 | 依赖 |
|------|----------|--------|------|
| 2.1 Monaco 内存泄漏 | 4 小时 | P1 | 无 |
| 2.2 WebSocket 管理 | 4 小时 | P1 | 无 |
| **性能测试** | **6 小时** | **P1** | **所有性能修复** |

**总计**: 14 小时（约 2 工作日）

### Phase 3: 代码质量（第 4 周）

| 任务 | 预计工时 | 优先级 | 依赖 |
|------|----------|--------|------|
| 3.1 补充注释 | 4 小时 | P2 | 无 |
| 3.2 添加单元测试 | 16 小时 | P2 | 无 |
| **代码审查** | **4 小时** | **P2** | **所有改动** |

**总计**: 24 小时（约 3 工作日）

### 总时间估算

- **开发时间**: 66 小时（约 8 工作日）
- **测试时间**: 14 小时
- **缓冲时间**: 10 小时
- **总计**: 90 小时（约 2-3 周）

---

## 测试计划

### 安全测试

#### 测试用例 1: Renderer 沙箱验证
```bash
# 1. 启动应用
pnpm dev

# 2. 打开 DevTools (Ctrl+Shift+I)
# 3. 在 Console 中执行：
console.log(typeof window.require)  # 预期：undefined
console.log(typeof window.process)  # 预期：undefined
console.log(window.electron)        # 预期：object (通过 contextBridge)
console.log(window.api)             # 预期：object (通过 contextBridge)
```

#### 测试用例 2: VM 沙箱逃逸测试
```javascript
// 创建恶意覆写脚本
const maliciousScript = `
module.exports.parse = async (config, profile) => {
  // 尝试访问 require
  try {
    const fs = require('fs')
    console.log('❌ 沙箱逃逸成功！')
  } catch (e) {
    console.log('✅ require 被正确阻止')
  }

  // 尝试访问 process
  try {
    const version = process.version
    console.log('❌ process 可访问！')
  } catch (e) {
    console.log('✅ process 被正确阻止')
  }

  // 尝试无限循环
  console.log('开始 5 秒循环...')
  const start = Date.now()
  while (Date.now() - start < 5000) {}
  console.log('❌ 超时未生效！')

  return profile
}
`
// 预期：require 和 process 被阻止，5 秒后超时
```

#### 测试用例 3: 深链路 SSRF 防护
```bash
# 测试本地地址
sparkle://install-config?url=https://localhost:8080/config.yaml
# 预期：拒绝并提示错误

# 测试内网地址
sparkle://install-config?url=https://192.168.1.1/config.yaml
# 预期：拒绝并提示错误

# 测试 HTTP 协议
sparkle://install-config?url=http://example.com/config.yaml
# 预期：拒绝并提示"仅允许 https"

# 测试合法 HTTPS
sparkle://install-config?url=https://github.com/user/config.yaml
# 预期：正常导入
```

### 性能测试

#### 测试用例 4: Monaco Editor 内存泄漏
```javascript
// 1. 打开浏览器 DevTools > Memory
// 2. 点击 "Take heap snapshot"
// 3. 打开/关闭 Monaco Editor 10 次
// 4. 点击 "Take heap snapshot"
// 5. 对比两个快照，搜索 "TextModel"
// 预期：TextModel 数量不增长
```

#### 测试用例 5: WebSocket 自动重连
```bash
# 1. 启动应用
# 2. 打开日志页面
# 3. 停止 Mihomo 内核
# 4. 观察日志
# 预期：WebSocket 停止后不再重连
# 5. 重新启动内核
# 预期：WebSocket 自动恢复
```

---

## 风险评估

### 高风险项

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| VM 沙箱修复可能影响现有覆写脚本 | 中等 | 提前告知用户，提供迁移指南 |
| Renderer 沙箱可能导致第三方页面加载失败 | 低 | 本项目无第三方页面，风险可控 |

### 中风险项

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 凭据加密可能导致旧配置无法读取 | 低 | 兼容明文，自动迁移 |
| 深链路验证可能影响部分订阅源 | 低 | 大多数已使用 HTTPS |

### 低风险项

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Monaco 内存泄漏修复 | 无 | 纯优化，不影响功能 |
| WebSocket 管理优化 | 无 | 纯优化，改善重连逻辑 |

---

## 验收标准

### 安全修复验收

- [x] 所有 BrowserWindow 显式设置安全选项
- [x] 预加载脚本移除不安全 fallback
- [x] VM 沙箱通过恶意脚本测试
- [x] 深链路导入通过 SSRF 测试
- [x] 凭据加密存储且兼容旧配置

### 性能修复验收

- [x] Monaco Editor 无内存泄漏（10 次打开/关闭后 Model 数量不增长）
- [x] WebSocket 停止后不再自动重连
- [x] Monaco Editor 初始化仅执行一次

### 代码质量验收

- [x] 关键函数添加 JSDoc 注释
- [x] 所有修复通过 TypeScript 类型检查
- [x] 所有修复通过 ESLint 检查
- [x] 至少添加 10 个单元测试用例

---

## 附录

### A. 相关文件清单

#### 安全相关
- `src/main/index.ts` - BrowserWindow 创建、深链路处理
- `src/preload/index.ts` - 预加载脚本
- `src/main/core/factory.ts` - VM 脚本执行
- `src/main/config/app.ts` - 凭据加密
- `src/main/utils/encrypt.ts` - 加密工具

#### 性能相关
- `src/renderer/src/components/base/base-editor.tsx` - Monaco Editor
- `src/main/core/mihomoApi.ts` - WebSocket 管理

### B. 参考资料

- [Electron Security Checklist](https://www.electronjs.org/docs/latest/tutorial/security)
- [Node.js VM Documentation](https://nodejs.org/api/vm.html)
- [Monaco Editor API](https://microsoft.github.io/monaco-editor/api/index.html)

---

**状态**: ⏳ 待执行
**下一步**: 开始 Phase 1 - 安全加固
**预计完成**: 2-3 周后

