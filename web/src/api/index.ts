import { useStorage } from '@vueuse/core'
import axios from 'axios'
import { useToastStore } from '@/stores/toast'

const tokenRef = useStorage('admin_token', '')
const accountIdRef = useStorage('current_account_id', '')

const api = axios.create({
  baseURL: '/',
  timeout: 20000,
})

let lastNetworkToastAt = 0
function showNetworkToast(message: string) {
  const now = Date.now()
  if (now - lastNetworkToastAt < 5000)
    return
  lastNetworkToastAt = now
  useToastStore().error(message)
}

api.interceptors.request.use((config) => {
  const token = tokenRef.value
  if (token) {
    config.headers['x-admin-token'] = token
  }
  const accountId = accountIdRef.value
  if (accountId && !config.headers['x-account-id']) {
    config.headers['x-account-id'] = accountId
  }
  return config
}, error => Promise.reject(error))

api.interceptors.response.use((response) => {
  return response
}, (error) => {
  if (axios.isCancel(error) || error?.code === 'ERR_CANCELED') {
    return Promise.reject(error)
  }
  if (error?.config?.skipErrorToast === true)
    return Promise.reject(error)

  const toast = useToastStore()

  if (error.response) {
    if (error.response.status === 401) {
      if (!window.location.pathname.includes('/login')) {
        tokenRef.value = ''
        window.location.href = '/login'
        toast.warning('登录已过期，请重新登录')
      }
    }
    else if (error.response.status >= 500) {
      const backendError = String(error.response.data?.error || error.response.data?.message || '')
      if (backendError === '账号未运行' || backendError === 'API Timeout' || backendError === 'Request Timeout') {
        return Promise.reject(error)
      }
      toast.error(`服务器错误 ${error.response.status} ${error.response.statusText}`)
    }
    else {
      toast.error('请求失败，请联系管理员')
    }
  }
  else if (error.request) {
    if (error.code === 'ECONNABORTED') {
      showNetworkToast('请求超时，请稍后重试')
    }
    else {
      showNetworkToast('网络错误，无法连接到服务器')
    }
  }
  else {
    toast.error(`错误: ${error.message}`)
  }

  return Promise.reject(error)
})

export default api
