import { lazy, Suspense } from 'react'
import { Navigate } from 'react-router-dom'
import { Spinner } from '@heroui/react'

// 使用 React.lazy() 懒加载所有页面组件
const Override = lazy(() => import('@renderer/pages/override'))
const Proxies = lazy(() => import('@renderer/pages/proxies'))
const Rules = lazy(() => import('@renderer/pages/rules'))
const Settings = lazy(() => import('@renderer/pages/settings'))
const Profiles = lazy(() => import('@renderer/pages/profiles'))
const Logs = lazy(() => import('@renderer/pages/logs'))
const Connections = lazy(() => import('@renderer/pages/connections'))
const Mihomo = lazy(() => import('@renderer/pages/mihomo'))
const Sysproxy = lazy(() => import('@renderer/pages/syspeoxy'))
const Tun = lazy(() => import('@renderer/pages/tun'))
const Resources = lazy(() => import('@renderer/pages/resources'))
const DNS = lazy(() => import('@renderer/pages/dns'))
const Sniffer = lazy(() => import('@renderer/pages/sniffer'))
const SubStore = lazy(() => import('@renderer/pages/substore'))

// 包装 Suspense 的辅助函数
const withSuspense = (element: JSX.Element): JSX.Element => (
  <Suspense
    fallback={
      <div className="w-full h-full flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    }
  >
    {element}
  </Suspense>
)
const routes = [
  {
    path: '/mihomo',
    element: withSuspense(<Mihomo />)
  },
  {
    path: '/sysproxy',
    element: withSuspense(<Sysproxy />)
  },
  {
    path: '/tun',
    element: withSuspense(<Tun />)
  },
  {
    path: '/proxies',
    element: withSuspense(<Proxies />)
  },
  {
    path: '/rules',
    element: withSuspense(<Rules />)
  },
  {
    path: '/resources',
    element: withSuspense(<Resources />)
  },
  {
    path: '/dns',
    element: withSuspense(<DNS />)
  },
  {
    path: '/sniffer',
    element: withSuspense(<Sniffer />)
  },
  {
    path: '/logs',
    element: withSuspense(<Logs />)
  },
  {
    path: '/connections',
    element: withSuspense(<Connections />)
  },
  {
    path: '/override',
    element: withSuspense(<Override />)
  },
  {
    path: '/profiles',
    element: withSuspense(<Profiles />)
  },
  {
    path: '/settings',
    element: withSuspense(<Settings />)
  },
  {
    path: '/substore',
    element: withSuspense(<SubStore />)
  },
  {
    path: '/',
    element: <Navigate to="/proxies" />
  }
]

export default routes
