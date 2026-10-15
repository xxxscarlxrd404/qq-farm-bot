export interface MenuItem {
  path: string
  name: string
  label: string
  icon: string
  component: () => Promise<any>
  adminOnly?: boolean
  showInNav?: boolean
}

export const menuRoutes: MenuItem[] = [
  {
    path: '',
    name: 'dashboard',
    label: '概览',
    icon: 'i-carbon-chart-pie',
    component: () => import('@/views/Dashboard.vue'),
  },
  {
    path: 'personal',
    name: 'personal',
    label: '个人',
    icon: 'i-carbon-user',
    component: () => import('@/views/Personal.vue'),
  },
  {
    path: 'friends',
    name: 'friends',
    label: '好友',
    icon: 'i-carbon-user-multiple',
    component: () => import('@/views/Friends.vue'),
  },
  {
    path: 'pet',
    name: 'pet',
    label: '宠物',
    icon: 'i-fa-solid-paw',
    component: () => import('@/views/Pet.vue'),
  },
  {
    path: 'activity',
    name: 'activity',
    label: '活动',
    icon: 'i-carbon-gift',
    component: () => import('@/views/Activity.vue'),
  },
  {
    path: 'shop',
    name: 'shop',
    label: '商城',
    icon: 'i-carbon-shopping-cart',
    component: () => import('@/views/Shop.vue'),
  },
  {
    path: 'illustrated',
    name: 'illustrated',
    label: '图鉴',
    icon: 'i-carbon-book',
    component: () => import('@/views/Illustrated.vue'),
  },
  {
    path: 'analytics',
    name: 'analytics',
    label: '分析',
    icon: 'i-carbon-analytics',
    component: () => import('@/views/Analytics.vue'),
  },
  {
    path: 'settings',
    name: 'Settings',
    label: '账号设置',
    icon: 'i-carbon-settings',
    component: () => import('@/views/Settings.vue'),
  },
  {
    path: 'system-settings',
    name: 'SystemSettings',
    label: '系统设置',
    icon: 'i-carbon-settings-services',
    component: () => import('@/views/Settings.vue'),
  },
]
