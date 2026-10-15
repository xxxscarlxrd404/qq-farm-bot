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
    label: '数据概览',
    icon: 'i-carbon-chart-pie',
    component: () => import('@/views/Dashboard.vue'),
  },
  {
    path: 'settings',
    name: 'Settings',
    label: '账号设置',
    icon: 'i-carbon-user-settings',
    component: () => import('@/views/Settings.vue'),
  },
  {
    path: 'personal',
    name: 'personal',
    label: '我的农场',
    icon: 'i-carbon-sprout',
    component: () => import('@/views/Personal.vue'),
  },
  {
    path: 'friends',
    name: 'friends',
    label: '我的好友',
    icon: 'i-carbon-user-multiple',
    component: () => import('@/views/Friends.vue'),
  },
  {
    path: 'pet',
    name: 'pet',
    label: '宠物守护',
    icon: 'i-fa-solid-paw',
    component: () => import('@/views/Pet.vue'),
  },
  {
    path: 'activity',
    name: 'activity',
    label: '限时活动',
    icon: 'i-carbon-gift',
    component: () => import('@/views/Activity.vue'),
  },
  {
    path: 'ranking',
    name: 'ranking',
    label: '本站排行',
    icon: '/ranking/rank.svg',
    component: () => import('@/views/Ranking.vue'),
  },
  {
    path: 'shop',
    name: 'shop',
    label: '道具商城',
    icon: 'i-carbon-shopping-cart',
    component: () => import('@/views/Shop.vue'),
  },
  {
    path: 'illustrated',
    name: 'illustrated',
    label: '作物图鉴',
    icon: 'i-carbon-book',
    component: () => import('@/views/Illustrated.vue'),
  },
  {
    path: 'analytics',
    name: 'analytics',
    label: '作物分析',
    icon: 'i-carbon-analytics',
    component: () => import('@/views/Analytics.vue'),
  },
  {
    path: 'admin',
    name: 'admin',
    label: '后台管理',
    icon: 'i-carbon-settings-adjust',
    component: () => import('@/views/AdminPanel.vue'),
    adminOnly: true,
  },
]
