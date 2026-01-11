import { useRef, useState, useEffect } from 'react'
import { useTheme } from 'next-themes'
import { nanoid } from 'nanoid'
import React from 'react'
import { useAppConfig } from '@renderer/hooks/use-app-config'
type Language = 'yaml' | 'javascript' | 'css' | 'json' | 'text'

interface Props {
  value: string
  originalValue?: string
  diffRenderSideBySide?: boolean
  readOnly?: boolean
  language: Language
  onChange?: (value: string) => void
}

// 跨编辑器实例共享的初始化标志
const MONACO_INIT_FLAG = '__sparkle_monaco_initialized__'
let initialized = false
let monaco: typeof import('monaco-editor') | null = null
let MonacoEditor: React.ComponentType<any> | null = null
let MonacoDiffEditor: React.ComponentType<any> | null = null

const monacoInitialization = async (): Promise<void> => {
  // 检查全局标志，避免重复初始化
  if (initialized || (globalThis as Record<string, unknown>)[MONACO_INIT_FLAG]) return

  // 动态导入 Monaco
  if (!monaco) {
    monaco = await import('monaco-editor')
    const { default: ReactMonacoEditor } = await import('react-monaco-editor')
    MonacoEditor = ReactMonacoEditor
    MonacoDiffEditor = ReactMonacoEditor.MonacoDiffEditor
    const { configureMonacoYaml } = await import('monaco-yaml')
    const metaSchema = await import('meta-json-schema/schemas/meta-json-schema.json')
    const pac = await import('types-pac/pac.d.ts?raw')

    // configure yaml worker
    configureMonacoYaml(monaco, {
      validate: true,
      enableSchemaRequest: true,
      schemas: [
        {
          uri: 'http://example.com/meta-json-schema.json',
          fileMatch: ['**/*.clash.yaml'],
          // @ts-ignore // type JSONSchema7
          schema: {
            ...(metaSchema.default || metaSchema),
            patternProperties: {
              '\\+rules': {
                type: 'array',
                $ref: '#/definitions/rules',
                description: '"+"开头表示将内容插入到原数组前面'
              },
              'rules\\+': {
                type: 'array',
                $ref: '#/definitions/rules',
                description: '"+"结尾表示将内容追加到原数组后面'
              },
              '\\+proxies': {
                type: 'array',
                $ref: '#/definitions/proxies',
                description: '"+"开头表示将内容插入到原数组前面'
              },
              'proxies\\+': {
                type: 'array',
                $ref: '#/definitions/proxies',
                description: '"+"结尾表示将内容追加到原数组后面'
              },
              '\\+proxy-groups': {
                type: 'array',
                $ref: '#/definitions/proxy-groups',
                description: '"+"开头表示将内容插入到原数组前面'
              },
              'proxy-groups\\+': {
                type: 'array',
                $ref: '#/definitions/proxy-groups',
                description: '"+"结尾表示将内容追加到原数组后面'
              },
              '^\\+': {
                type: 'array',
                description: '"+"开头表示将内容插入到原数组前面'
              },
              '\\+$': {
                type: 'array',
                description: '"+"结尾表示将内容追加到原数组后面'
              },
              '!$': {
                type: 'object',
                description: '"!"结尾表示强制覆盖该项而不进行递归合并'
              }
            }
          }
        }
      ]
    })
    // configure PAC definition
    monaco.languages.typescript.javascriptDefaults.addExtraLib((pac as any).default || pac, 'pac.d.ts')
  }

  initialized = true
  // 设置全局标志
  ;(globalThis as Record<string, unknown>)[MONACO_INIT_FLAG] = true
}

export const BaseEditor: React.FC<Props> = (props) => {
  const [isLoaded, setIsLoaded] = useState(false)
  const { theme, systemTheme } = useTheme()
  const trueTheme = theme === 'system' ? systemTheme : theme
  const {
    value,
    originalValue,
    diffRenderSideBySide = false,
    readOnly = false,
    language,
    onChange
  } = props
  const { appConfig: { disableAnimation = false } = {} } = useAppConfig()

  // 异步初始化 Monaco
  useEffect(() => {
    let mounted = true

    const initMonaco = async () => {
      await monacoInitialization()
      if (mounted) {
        setIsLoaded(true)
      }
    }

    initMonaco()

    return () => {
      mounted = false
    }
  }, [])

  const editorRef = useRef<any>(undefined)
  const diffEditorRef = useRef<any>(undefined)

  // 追踪 Model 实例
  const modelRef = useRef<any>(null)
  const originalModelRef = useRef<any>(null)
  const modifiedModelRef = useRef<any>(null)

  // 释放所有 Model 实例
  const disposeModels = (): void => {
    modelRef.current?.dispose()
    modelRef.current = null
    originalModelRef.current?.dispose()
    originalModelRef.current = null
    modifiedModelRef.current?.dispose()
    modifiedModelRef.current = null
  }

  const editorDidMount = (editor: any): void => {
    if (!monaco) return
    editorRef.current = editor

    const uri = monaco.Uri.parse(`${nanoid()}.${language === 'yaml' ? 'clash' : ''}.${language}`)
    const model = monaco.editor.createModel(value, language, uri)
    editorRef.current.setModel(model)
    modelRef.current = model // 追踪 model
  }

  const diffEditorDidMount = (editor: any): void => {
    if (!monaco) return
    diffEditorRef.current = editor

    const originalUri = monaco.Uri.parse(
      `original-${nanoid()}.${language === 'yaml' ? 'clash' : ''}.${language}`
    )
    const modifiedUri = monaco.Uri.parse(
      `modified-${nanoid()}.${language === 'yaml' ? 'clash' : ''}.${language}`
    )
    const originalModel = monaco.editor.createModel(originalValue, language, originalUri)
    const modifiedModel = monaco.editor.createModel(value, language, modifiedUri)
    editorRef.current.setModel(originalModel)
    diffEditorRef.current.setModel({
      original: originalModel,
      modified: modifiedModel
    })
    originalModelRef.current = originalModel
    modifiedModelRef.current = modifiedModel
  }

  // 显示加载态
  if (!isLoaded || !MonacoEditor) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-default-100 dark:bg-default-900">
        <div className="text-foreground-500">Loading editor...</div>
      </div>
    )
  }

  const options = {
    tabSize: ['yaml', 'javascript', 'json'].includes(language) ? 2 : 4, // 根据语言类型设置缩进大小
    minimap: {
      enabled: document.documentElement.clientWidth >= 1500 // 超过一定宽度显示 minimap 滚动条
    },
    mouseWheelZoom: true, // 按住 Ctrl 滚轮调节缩放比例
    readOnly: readOnly, // 只读模式
    renderValidationDecorations: 'on' as 'off' | 'on' | 'editable', // 只读模式下显示校验信息
    quickSuggestions: {
      strings: true, // 字符串类型的建议
      comments: true, // 注释类型的建议
      other: true // 其他类型的建议
    },
    fontFamily: `Maple Mono NF CN,Fira Code, JetBrains Mono, Roboto Mono, "Source Code Pro", Consolas, Menlo, Monaco, monospace, "Courier New", "Apple Color Emoji", "Noto Color Emoji"`,
    fontLigatures: true, // 连字符
    smoothScrolling: !disableAnimation, // 禁用动画时关闭平滑滚动
    pixelRatio: window.devicePixelRatio, // 设置像素比
    renderSideBySide: diffRenderSideBySide, // 侧边显示
    glyphMargin: false, // 禁用字形边距
    folding: true, // 启用代码折叠
    scrollBeyondLastLine: false, // 禁止滚动超过最后一行
    automaticLayout: true, // 自动布局
    wordWrap: 'on' as 'on' | 'off', // 自动换行 x
    // 禁用动画时的性能优化选项
    cursorBlinking: (disableAnimation ? 'solid' : 'blink') as 'solid' | 'blink', // 禁用光标闪烁动画
    cursorSmoothCaretAnimation: (disableAnimation ? 'off' : 'on') as 'off' | 'on', // 禁用光标移动动画
    scrollbar: {
      useShadows: !disableAnimation, // 禁用滚动条阴影
      verticalScrollbarSize: disableAnimation ? 10 : 14, // 减小滚动条尺寸
      horizontalScrollbarSize: disableAnimation ? 10 : 14
    },
    suggest: {
      insertMode: (disableAnimation ? 'replace' : 'insert') as 'replace' | 'insert', // 简化建议插入模式
      showIcons: !disableAnimation // 禁用建议图标以减少渲染
    },
    hover: {
      enabled: !disableAnimation, // 禁用悬停提示
      delay: disableAnimation ? 0 : 300
    }
  }

  if (originalValue !== undefined) {
    return (
      <MonacoDiffEditor
        language={language}
        original={originalValue}
        value={value}
        height="100%"
        theme={trueTheme?.includes('light') ? 'vs' : 'vs-dark'}
        options={options}
        editorDidMount={diffEditorDidMount}
        editorWillUnmount={disposeModels}
        onChange={onChange}
      />
    )
  }

  return (
    <MonacoEditor
      language={language}
      value={value}
      height="100%"
      theme={trueTheme?.includes('light') ? 'vs' : 'vs-dark'}
      options={options}
      editorDidMount={editorDidMount}
      editorWillUnmount={disposeModels}
      onChange={onChange}
    />
  )
}
