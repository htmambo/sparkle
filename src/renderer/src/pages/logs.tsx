import BasePage from '@renderer/components/base/base-page'
import LogItem from '@renderer/components/logs/log-item'
import { useEffect, useMemo, useRef, useState } from 'react'
import { startMihomoLogs, stopMihomoLogs } from '@renderer/utils/ipc'
import { Button, Divider, Input } from '@heroui/react'
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import { IoLocationSharp } from 'react-icons/io5'
import { CgTrash } from 'react-icons/cg'

import { includesIgnoreCase } from '@renderer/utils/includes'

// 日志缓存，跨组件实例共享
const cachedLogs: {
  log: ControllerLog[]
  trigger: ((i: ControllerLog[]) => void) | null
  clean: () => void
} = {
  log: [],
  trigger: null,
  clean(): void {
    this.log = []
    if (this.trigger !== null) {
      this.trigger(this.log)
    }
  }
}

// 全局日志监听器，确保即使组件未挂载也缓存日志
const logBuffer: ControllerLog[] = []
let logFlushTimer: ReturnType<typeof setTimeout> | null = null

const flushLogs = (): void => {
  if (logBuffer.length === 0) return

  // 批量添加到缓存
  for (const log of logBuffer) {
    log.time = new Date().toLocaleString()
    cachedLogs.log.push(log)
    if (cachedLogs.log.length >= 500) {
      cachedLogs.log.shift()
    }
  }

  // 清空 buffer
  logBuffer.length = 0

  // 触发 UI 更新
  if (cachedLogs.trigger !== null) {
    cachedLogs.trigger(cachedLogs.log)
  }
}

const Logs: React.FC = () => {
  const [logs, setLogs] = useState<ControllerLog[]>(cachedLogs.log)
  const [filter, setFilter] = useState('')
  const [trace, setTrace] = useState(true)

  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const filteredLogs = useMemo(() => {
    if (filter === '') return logs
    return logs.filter((log) => {
      return includesIgnoreCase(log.payload, filter) || includesIgnoreCase(log.type, filter)
    })
  }, [logs, filter])

  // WebSocket 订阅管理
  useEffect(() => {
    startMihomoLogs()

    const handleLogs = (_e: unknown, log: ControllerLog): void => {
      logBuffer.push(log)

      // 节流：每 100ms 批量更新一次
      if (logFlushTimer === null) {
        logFlushTimer = setTimeout(() => {
          flushLogs()
          logFlushTimer = null
        }, 100)
      }
    }

    window.electron.ipcRenderer.on('mihomoLogs', handleLogs)

    return () => {
      window.electron.ipcRenderer.removeListener('mihomoLogs', handleLogs)
      stopMihomoLogs()
    }
  }, [])

  useEffect(() => {
    if (!trace) return
    virtuosoRef.current?.scrollToIndex({
      index: filteredLogs.length - 1,
      behavior: 'smooth',
      align: 'end',
      offset: 0
    })
  }, [filteredLogs, trace])

  useEffect(() => {
    // 注册 trigger 函数
    const old = cachedLogs.trigger
    cachedLogs.trigger = (a): void => {
      setLogs([...a])
    }

    return (): void => {
      // 组件卸载时取消注册
      cachedLogs.trigger = old
    }
  }, [])

  return (
    <BasePage title="实时日志">
      <div className="sticky top-0 z-40">
        <div className="w-full flex p-2">
          <Input
            size="sm"
            value={filter}
            placeholder="筛选过滤"
            isClearable
            onValueChange={setFilter}
          />
          <Button
            size="sm"
            isIconOnly
            className="ml-2"
            color={trace ? 'primary' : 'default'}
            variant={trace ? 'solid' : 'bordered'}
            onPress={() => {
              setTrace((prev) => !prev)
            }}
          >
            <IoLocationSharp className="text-lg" />
          </Button>
          <Button
            size="sm"
            isIconOnly
            title="清空日志"
            className="ml-2"
            variant="light"
            color="danger"
            onPress={() => {
              cachedLogs.clean()
            }}
          >
            <CgTrash className="text-lg" />
          </Button>
        </div>
        <Divider />
      </div>
      <div className="h-[calc(100vh-100px)] mt-px">
        <Virtuoso
          ref={virtuosoRef}
          data={filteredLogs}
          initialTopMostItemIndex={filteredLogs.length - 1}
          followOutput={trace}
          itemContent={(i, log) => {
            return (
              <LogItem
                index={i}
                key={log.payload + i}
                time={log.time}
                type={log.type}
                payload={log.payload}
              />
            )
          }}
        />
      </div>
    </BasePage>
  )
}

export default Logs
