import React, { createContext, useContext, ReactNode } from 'react'
import useSWR from 'swr'
import { mihomoGroups } from '@renderer/utils/ipc'

interface GroupsContextType {
  groups: ControllerMixedGroup[] | undefined
  mutate: () => void
}

const GroupsContext = createContext<GroupsContextType | undefined>(undefined)

export const GroupsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [coreStarted, setCoreStarted] = React.useState(false)
  const { data: groups, mutate } = useSWR<ControllerMixedGroup[]>('mihomoGroups', mihomoGroups, {
    // core 启动前禁用重试，避免密集 IPC 调用
    revalidateOnFocus: coreStarted,
    revalidateOnReconnect: coreStarted,
    errorRetryCount: coreStarted ? 10 : 0,
    errorRetryInterval: coreStarted ? 200 : 0
  })

  React.useEffect(() => {
    const handleGroupsUpdated = (): void => {
      mutate()
    }

    const handleCoreStarted = (): void => {
      setCoreStarted(true)
      mutate()
    }

    window.electron.ipcRenderer.on('groupsUpdated', handleGroupsUpdated)
    window.electron.ipcRenderer.on('core-started', handleCoreStarted)

    return (): void => {
      window.electron.ipcRenderer.removeListener('groupsUpdated', handleGroupsUpdated)
      window.electron.ipcRenderer.removeListener('core-started', handleCoreStarted)
    }
  }, [mutate])

  return <GroupsContext.Provider value={{ groups, mutate }}>{children}</GroupsContext.Provider>
}

export const useGroups = (): GroupsContextType => {
  const context = useContext(GroupsContext)
  if (context === undefined) {
    throw new Error('useGroups must be used within an GroupsProvider')
  }
  return context
}
