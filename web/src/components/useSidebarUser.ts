import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'

export function useSidebarUser() {
  const router = useRouter()
  const userStore = useUserStore()

  async function handleLogout() {
    await userStore.logout()
    router.push('/login')
  }

  const userInitial = computed(() => {
    return (userStore.username || 'U').slice(0, 1).toUpperCase()
  })

  return {
    userStore,
    handleLogout,
    userInitial,
  }
}
