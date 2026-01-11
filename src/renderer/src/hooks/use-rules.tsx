import React, { createContext, useContext, ReactNode } from 'react'
import useSWR from 'swr'
import { mihomoRules } from '@renderer/utils/ipc'

interface RulesContextType {
  rules: ControllerRules | undefined
  mutate: () => void
}

const RulesContext = createContext<RulesContextType | undefined>(undefined)

export const RulesProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [coreStarted, setCoreStarted] = React.useState(false)
  const { data: rules, mutate } = useSWR<ControllerRules>('mihomoRules', mihomoRules, {
    // core 启动前禁用重试，避免密集 IPC 调用
    revalidateOnFocus: coreStarted,
    revalidateOnReconnect: coreStarted,
    errorRetryCount: coreStarted ? 10 : 0,
    errorRetryInterval: coreStarted ? 200 : 0
  })

  React.useEffect(() => {
    const handleRulesUpdated = (): void => {
      mutate()
    }

    const handleCoreStarted = (): void => {
      setCoreStarted(true)
      mutate()
    }

    window.electron.ipcRenderer.on('rulesUpdated', handleRulesUpdated)
    window.electron.ipcRenderer.on('core-started', handleCoreStarted)

    return (): void => {
      window.electron.ipcRenderer.removeListener('rulesUpdated', handleRulesUpdated)
      window.electron.ipcRenderer.removeListener('core-started', handleCoreStarted)
    }
  }, [mutate])

  return <RulesContext.Provider value={{ rules, mutate }}>{children}</RulesContext.Provider>
}

export const useRules = (): RulesContextType => {
  const context = useContext(RulesContext)
  if (context === undefined) {
    throw new Error('useRules must be used within an RulesProvider')
  }
  return context
}
