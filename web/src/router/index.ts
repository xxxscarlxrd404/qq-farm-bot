import { useStorage } from '@vueuse/core'
import axios from 'axios'
import NProgress from 'nprogress'
import { createRouter, createWebHistory } from 'vue-router'
import { menuRoutes } from './menu'
import 'nprogress/nprogress.css'

NProgress.configure({ showSpinner: false })

const adminToken = useStorage('admin_token', '')
let validatedToken = ''
let validatingPromise: Promise<boolean> | null = null

const TOKEN_VALID_CACHE_KEY = 'token_valid_cache'
const TOKEN_VALID_CACHE_TTL = 5 * 60 * 1000

interface TokenCacheEntry {
  token: string
  validUntil: number
}

function getTokenCache(): TokenCacheEntry | null {
  try {
    const raw = localStorage.getItem(TOKEN_VALID_CACHE_KEY)
    if (!raw) return null
    const entry = JSON.parse(raw) as TokenCacheEntry
    if (entry.validUntil > Date.now()) return entry
    localStorage.removeItem(TOKEN_VALID_CACHE_KEY)
    return null
  } catch {
    return null
  }
}

function setTokenCache(token: string) {
  try {
    localStorage.setItem(TOKEN_VALID_CACHE_KEY, JSON.stringify({
      token,
      validUntil: Date.now() + TOKEN_VALID_CACHE_TTL,
    }))
  } catch {}
}

function clearTokenCache() {
  try { localStorage.removeItem(TOKEN_VALID_CACHE_KEY) } catch {}
}

async function ensureTokenValid() {
  const token = String(adminToken.value || '').trim()
  if (!token) return false

  if (validatedToken && validatedToken === token) return true

  const cache = getTokenCache()
  if (cache && cache.token === token) {
    validatedToken = token
    return true
  }

  if (validatingPromise) return validatingPromise

  validatingPromise = axios.get('/api/auth/validate', {
    headers: { 'x-admin-token': token },
    timeout: 6000,
  }).then((res) => {
    const ok = !!(res.data && res.data.ok)
    if (ok) {
      validatedToken = token
      setTokenCache(token)
    } else {
      clearTokenCache()
    }
    return ok
  }).catch(() => {
    clearTokenCache()
    return false
  }).finally(() => {
    validatingPromise = null
  })

  return validatingPromise
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: () => import('@/layouts/DefaultLayout.vue'),
      children: menuRoutes.map(route => ({
        path: route.path,
        name: route.name,
        component: route.component,
      })),
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/Login.vue'),
    },
    {
      path: '/renewal',
      name: 'renewal',
      component: () => import('@/views/Renewal.vue'),
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  NProgress.start()

  if (to.name === 'login' || to.name === 'renewal') {
    if (!adminToken.value) {
      validatedToken = ''
      return true
    }
    const valid = await ensureTokenValid()
    if (valid) return { path: '/' }
    adminToken.value = ''
    validatedToken = ''
    return true
  }

  if (!adminToken.value) {
    validatedToken = ''
    return { name: 'login' }
  }

  const valid = await ensureTokenValid()
  if (!valid) {
    adminToken.value = ''
    validatedToken = ''
    return { name: 'login' }
  }

  return true
})

router.afterEach(() => NProgress.done())


router.onError((error, to) => {
  console.error('[Router] 导航加载异常:', error)
  if (error.message.includes('Failed to fetch dynamically imported module') || error.message.includes('Importing a module script failed')) {
    window.location.href = to.fullPath
  }
})

export default router
