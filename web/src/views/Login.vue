<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api'
import { useUserStore } from '@/stores/user'

declare const __APP_VERSION__: string

const router = useRouter()
const userStore = useUserStore()
const appVersion = __APP_VERSION__
const gameVersion = ref('')

const isLogin = ref(true)
const showPassword = ref(false)
const rememberAccount = ref(true)
const username = ref('')
const password = ref('')
const cardCode = ref('')
const error = ref('')
const success = ref('')
const loading = ref(false)
const showPasswordStrength = ref(false)
const lockoutRemaining = ref(0)
const rateLimitRemaining = ref(0)

const cardClaimEnabled = ref(false)
const cardClaimLoading = ref(false)
const showClaimModal = ref(false)
const claimModalContent = ref({ success: true, title: '', message: '', cardCode: '', days: 0 })

const passwordStrength = computed(() => {
  const pwd = password.value
  if (!pwd) return { score: 0, level: '', valid: false }
  let score = 0; if (pwd.length >= 6) score++; if (pwd.length >= 10) score++
  let typeCount = 0
  if (/[a-z]/.test(pwd)) typeCount++; if (/[A-Z]/.test(pwd)) typeCount++
  if (/\d/.test(pwd)) typeCount++; if (/[!@#$%^&*(),.?":{}|<>_\-+=[\]\\;'/`~]/.test(pwd)) typeCount++
  if (typeCount >= 2) score += 2; if (typeCount >= 3) score++; if (typeCount >= 4) score++
  const commonPasswords = ['password', '123456', 'qwerty', 'abc123', '111111']
  if (commonPasswords.some(p => pwd.toLowerCase().includes(p))) score = Math.max(0, score - 2)
  const level = score <= 2 ? '弱' : score <= 4 ? '中' : score <= 6 ? '强' : '非常强'
  const color = score <= 2 ? '#ef5350' : score <= 4 ? '#ffa726' : score <= 6 ? '#66bb6a' : '#43a047'
  return { score, level, color, valid: pwd.length >= 6 && typeCount >= 2 }
})

const usernameValid = computed(() => {
  const name = username.value
  if (!name) return { valid: false, message: '' }
  if (name.length < 3) return { valid: false, message: '用户名至少3位' }
  if (name.length > 32) return { valid: false, message: '用户名最多32位' }
  if (!/^\w+$/.test(name)) return { valid: false, message: '只能包含字母、数字、下划线' }
  return { valid: true, message: '' }
})

watch(password, () => { showPasswordStrength.value = false })

function validateForm(): boolean {
  if (!username.value) { error.value = '请输入用户名'; return false }
  if (!usernameValid.value.valid) { error.value = usernameValid.value.message; return false }
  if (!password.value) { error.value = '请输入密码'; return false }
  if (!isLogin.value) {
    if (!cardCode.value) { error.value = '请输入卡密'; return false }
  }
  return true
}

async function handleSubmit() {
  if (!validateForm()) return
  loading.value = true; error.value = ''; success.value = ''
  try {
    if (isLogin.value) {
      const result = await userStore.login(username.value, password.value)
      if (result.ok) {
        if (result.data?.mustChangePassword) success.value = '登录成功！请修改默认密码'
        setTimeout(() => { window.location.href = '/' }, 500)
      } else {
        if (result.errorType === 'rate_limit') { error.value = result.error || '请求过于频繁'; if (result.remainingMs) rateLimitRemaining.value = Math.ceil(result.remainingMs / 1000) }
        else if (result.errorType === 'locked') { error.value = result.error || '账户已被锁定'; if (result.remainingMs) lockoutRemaining.value = Math.ceil(result.remainingMs / 1000 / 60) }
        else error.value = result.error || '登录失败'
      }
    } else {
      const result = await userStore.register(username.value, password.value, cardCode.value)
      if (result.ok) { success.value = '注册成功，请登录'; isLogin.value = true; cardCode.value = ''; password.value = '' }
      else error.value = result.error || '注册失败'
    }
  } catch (e: any) {
    const data = e.response?.data
    if (data?.errorType === 'rate_limit') { error.value = data.error || '请求过于频繁'; if (data.remainingMs) rateLimitRemaining.value = Math.ceil(data.remainingMs / 1000) }
    else if (data?.errorType === 'locked') { error.value = data.error || '账户已被锁定'; if (data.remainingMs) lockoutRemaining.value = Math.ceil(data.remainingMs / 1000 / 60) }
    else error.value = data?.error || e.message || '操作异常'
  } finally { loading.value = false }
}

function toggleMode() { isLogin.value = !isLogin.value; error.value = ''; success.value = ''; showPasswordStrength.value = false; lockoutRemaining.value = 0; rateLimitRemaining.value = 0 }
function goToRenewal() { router.push('/renewal') }
async function checkCardClaimStatus() { try { const res = await api.get('/api/card-claim/status'); if (res.data.ok) cardClaimEnabled.value = res.data.enabled === true } catch { } }
async function claimFreeCard() {
  if (cardClaimLoading.value) return; cardClaimLoading.value = true; error.value = ''
  try {
    const res = await api.post('/api/card-claim/claim')
    if (res.data.ok) { cardCode.value = res.data.cardCode; claimModalContent.value = { success: true, title: '领取成功', message: `成功领取 ${res.data.days} 天卡密！`, cardCode: res.data.cardCode, days: res.data.days }; showClaimModal.value = true }
    else { claimModalContent.value = { success: false, title: '领取失败', message: res.data.error || '领取失败', cardCode: '', days: 0 }; showClaimModal.value = true }
  } catch (e: any) { claimModalContent.value = { success: false, title: '领取失败', message: e?.response?.data?.error || e.message || '领取失败', cardCode: '', days: 0 }; showClaimModal.value = true }
  finally { cardClaimLoading.value = false }
}
function closeClaimModal() { showClaimModal.value = false }

const showResetModal = ref(false)
const resetUsername = ref(''); const resetCardCode = ref('')
const resetVerifying = ref(false); const resetError = ref('')
const showResetPasswordModal = ref(false)
const resetNewPassword = ref(''); const resetConfirmPassword = ref('')
const resetPasswordLoading = ref(false); const resetPasswordError = ref('')
const showResetPasswordStrength = ref(false)

const resetPasswordStrength = computed(() => {
  const pwd = resetNewPassword.value
  if (!pwd) return { score: 0, level: '', valid: false }
  let score = 0; if (pwd.length >= 6) score++; if (pwd.length >= 10) score++
  let typeCount = 0
  if (/[a-z]/.test(pwd)) typeCount++; if (/[A-Z]/.test(pwd)) typeCount++
  if (/\d/.test(pwd)) typeCount++; if (/[!@#$%^&*(),.?":{}|<>_\-+=[\]\\;'/`~]/.test(pwd)) typeCount++
  if (typeCount >= 2) score += 2; if (typeCount >= 3) score++; if (typeCount >= 4) score++
  const level = score <= 2 ? '弱' : score <= 4 ? '中' : score <= 6 ? '强' : '非常强'
  const color = score <= 2 ? '#ef5350' : score <= 4 ? '#ffa726' : score <= 6 ? '#66bb6a' : '#43a047'
  return { score, level, color, valid: pwd.length >= 6 && typeCount >= 2 }
})

watch(resetNewPassword, () => { if (resetNewPassword.value) showResetPasswordStrength.value = true })
function openResetModal() { resetUsername.value = ''; resetCardCode.value = ''; resetError.value = ''; resetVerifying.value = false; showResetModal.value = true }
function closeResetModal() { showResetModal.value = false; resetError.value = '' }
async function handleResetVerify() {
  if (!resetUsername.value) { resetError.value = '请输入用户名'; return }
  if (!resetCardCode.value) { resetError.value = '请输入卡密'; return }
  resetVerifying.value = true; resetError.value = ''
  try {
    const result = await userStore.verifyResetPassword(resetUsername.value, resetCardCode.value)
    if (result.ok) { showResetModal.value = false; resetNewPassword.value = ''; resetConfirmPassword.value = ''; resetPasswordError.value = ''; showResetPasswordStrength.value = false; showResetPasswordModal.value = true }
    else resetError.value = result.error || '验证失败'
  } catch (e: any) { resetError.value = e?.response?.data?.error || e.message || '验证失败' }
  finally { resetVerifying.value = false }
}
function closeResetPasswordModal() { showResetPasswordModal.value = false; resetNewPassword.value = ''; resetConfirmPassword.value = ''; resetPasswordError.value = '' }
async function handleResetPassword() {
  if (!resetNewPassword.value) { resetPasswordError.value = '请输入新密码'; return }
  if (resetNewPassword.value.length < 6) { resetPasswordError.value = '密码长度至少6位'; return }
  if (!resetPasswordStrength.value.valid) { resetPasswordError.value = '密码强度不足'; return }
  if (resetNewPassword.value !== resetConfirmPassword.value) { resetPasswordError.value = '两次输入的密码不一致'; return }
  resetPasswordLoading.value = true; resetPasswordError.value = ''
  try {
    const result = await userStore.resetPassword(resetUsername.value, resetCardCode.value, resetNewPassword.value)
    if (result.ok) { showResetPasswordModal.value = false; success.value = '密码重置成功，请使用新密码登录'; isLogin.value = true; username.value = resetUsername.value; password.value = '' }
    else resetPasswordError.value = result.error || '重置失败'
  } catch (e: any) { resetPasswordError.value = e?.response?.data?.error || e.message || '重置失败' }
  finally { resetPasswordLoading.value = false }
}
onMounted(() => { checkCardClaimStatus(); fetchGameVersion() })
async function fetchGameVersion() { try { const r = await api.get('/api/game-version'); if (r.data.ok) gameVersion.value = r.data.clientVersion } catch { } }
</script>

<template>
<div class="pg">
  <div class="liquid-login-card">
    <!-- Liquid Glow & Top Light -->
    <div class="card-glow" />
    
    <!-- Custom Farm Logo -->
    <div class="logo-box">
      <img
        src="/qq-farm-logo.webp"
        alt="QQ经典农场"
        class="login-logo-img drop-shadow-[0_8px_20px_rgba(0,0,0,0.18)]"
      >
      <p class="tag mt-2">全自动智能托管 · 科技助农</p>
    </div>





    <form class="fm" @submit.prevent="handleSubmit">
      <div class="fld">
        <div class="inp">
          <span class="inp-ico">
            <img src="/yonghu.svg" alt="用户" class="h-5 w-5 object-contain" />
          </span>
          <input v-model="username" type="text" placeholder="请输入用户名" autocomplete="username">
        </div>
        <span v-if="username && !usernameValid.valid" class="input-hint">{{ usernameValid.message }}</span>
      </div>
      <div class="fld">
        <div class="inp">
          <span class="inp-ico">
            <img src="/mima.svg" alt="密码" class="h-5 w-5 object-contain" />
          </span>
          <input v-model="password" :type="showPassword ? 'text' : 'password'" placeholder="请输入密码" autocomplete="current-password">
          <button type="button" class="pwd-eye-btn" @click="showPassword = !showPassword">
            <span :class="showPassword ? 'i-carbon-view' : 'i-carbon-view-off'" />
          </button>
        </div>
        <div v-if="showPasswordStrength && password" class="pwd">
          <span class="pwd-bar"><i :style="{ width: Math.min(passwordStrength.score * 12.5, 100) + '%', background: passwordStrength.color }" /></span>
          <small :style="{ color: passwordStrength.color }">{{ passwordStrength.level }}</small>
        </div>
      </div>
      <!-- 记住账号 & 忘记密码 行 -->
      <div v-if="isLogin" class="flex items-center justify-between px-1 text-xs text-gray-500 select-none">
        <label class="flex items-center gap-2 cursor-pointer hover:text-blue-600 transition-colors">
          <input v-model="rememberAccount" type="checkbox" class="h-4 w-4 rounded-full border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer">
          <span class="font-medium">记住账号</span>
        </label>
        <a href="#" class="font-medium text-blue-600 hover:text-blue-700 hover:underline" @click.prevent="openResetModal">忘记密码？</a>
      </div>

      <div v-if="!isLogin" class="fld">
        <div class="inp">
          <span class="inp-ico">
            <img src="/qiamizhifu.svg" alt="卡密" class="h-5 w-5 object-contain" />
          </span>
          <input v-model="cardCode" type="text" placeholder="请输入卡密">
        </div>
        <button v-if="cardClaimEnabled" type="button" class="gift" :disabled="cardClaimLoading" @click="claimFreeCard">
          <span v-if="cardClaimLoading" class="i-svg-spinners-90-ring-with-bg text-xs" /><span v-else>🎁 免费领取卡密</span>
        </button>
      </div>
      <div v-if="error" class="nt nt-err"><span class="i-carbon-warning-alt" />{{ error }}<template v-if="lockoutRemaining > 0">（{{ lockoutRemaining }} 分钟后解锁）</template><template v-if="rateLimitRemaining > 0">（{{ rateLimitRemaining }} 秒后可重试）</template></div>
      <div v-if="success" class="nt nt-ok"><span class="i-carbon-checkmark-outline" />{{ success }}</div>
      
      <button type="submit" class="btn" :disabled="loading">
        <span v-if="loading" class="i-svg-spinners-90-ring-with-bg" />
        <template v-else>
          <img v-if="!isLogin" src="/zhuce.svg" alt="注册" class="h-5 w-5 object-contain brightness-0 invert" />
          <span v-else class="btn-icon i-carbon-login" />
          <span>{{ isLogin ? '登 录' : '注 册' }}</span>
        </template>
      </button>
    </form>

    <p class="ft">
      <span>{{ isLogin ? '还没有账号？' : '已有账号？' }}</span>
      <a href="#" @click.prevent="toggleMode">{{ isLogin ? '立即注册' : '立即登录' }}</a>
    </p>
    <div class="ver">
      <code v-if="gameVersion">游戏：{{ gameVersion }}</code>
      <code v-if="gameVersion">·</code><code>v{{ appVersion }}</code>
    </div>
  </div>

  <Teleport to="body"><Transition name="fade">
    <div v-if="showClaimModal" class="md-bg" @click.self="closeClaimModal"><div class="md-box">
      <div :class="['md-ico', claimModalContent.success ? 'md-ok' : 'md-err']"><div :class="claimModalContent.success ? 'i-carbon-checkmark' : 'i-carbon-close'" class="text-2xl" /></div>
      <h3>{{ claimModalContent.title }}</h3><p>{{ claimModalContent.message }}</p>
      <div v-if="claimModalContent.success && claimModalContent.cardCode" class="md-kc"><small>卡密已自动填入</small><code>{{ claimModalContent.cardCode }}</code></div>
      <button @click="closeClaimModal">{{ claimModalContent.success ? '开始注册' : '知道了' }}</button>
    </div></div>
  </Transition></Teleport>

  <Teleport to="body"><Transition name="fade">
    <div v-if="showResetModal" class="md-bg" @click.self="closeResetModal"><div class="md-box">
      <div class="md-ico md-ok"><div class="i-carbon-password text-2xl" /></div>
      <h3>找回密码</h3><p>请输入账号和注册卡密进行验证</p>
      <div class="fld"><div class="inp"><span class="inp-ico">
            <svg viewBox="0 0 24 24" class="h-4.5 w-4.5 fill-current">
              <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
            </svg>
          </span><input v-model="resetUsername" placeholder="用户名"></div></div>
      <div class="fld" style="margin-top:14px"><div class="inp"><span class="inp-ico">
            <svg viewBox="0 0 24 24" class="h-4.5 w-4.5 fill-current">
              <path d="M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"/>
            </svg>
          </span><input v-model="resetCardCode" placeholder="卡密"></div></div>
      <div v-if="resetError" class="nt nt-err" style="margin-top:12px"><span class="i-carbon-warning-alt" />{{ resetError }}</div>
      <div class="md-acts"><button class="md-cancel" @click="closeResetModal">取消</button><button class="md-confirm" :disabled="resetVerifying" @click="handleResetVerify"><span v-if="resetVerifying" class="i-svg-spinners-90-ring-with-bg text-xs" /><span v-else>验证</span></button></div>
    </div></div>
  </Transition></Teleport>

  <Teleport to="body"><Transition name="fade">
    <div v-if="showResetPasswordModal" class="md-bg" @click.self="closeResetPasswordModal"><div class="md-box">
      <div class="md-ico md-ok"><div class="i-carbon-security text-2xl" /></div>
      <h3>设置新密码</h3><p>验证通过，请设置新密码</p>
      <div class="fld"><div class="inp"><span class="inp-ico">
            <svg viewBox="0 0 24 24" class="h-4.5 w-4.5 fill-current">
              <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
            </svg>
          </span><input v-model="resetNewPassword" type="password" placeholder="新密码"></div></div>
      <div v-if="showResetPasswordStrength && resetNewPassword" class="pwd" style="margin-top:6px"><span class="pwd-bar"><i :style="{ width: Math.min(resetPasswordStrength.score * 12.5, 100) + '%', background: resetPasswordStrength.color }" /></span><small :style="{ color: resetPasswordStrength.color }">{{ resetPasswordStrength.level }}</small></div>
      <div class="fld" style="margin-top:14px"><div class="inp"><span class="inp-ico">
            <svg viewBox="0 0 24 24" class="h-4.5 w-4.5 fill-current">
              <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
            </svg>
          </span><input v-model="resetConfirmPassword" type="password" placeholder="确认密码"></div></div>
      <div v-if="resetPasswordError" class="nt nt-err" style="margin-top:12px"><span class="i-carbon-warning-alt" />{{ resetPasswordError }}</div>
      <div class="md-acts"><button class="md-cancel" @click="closeResetPasswordModal">取消</button><button class="md-confirm" :disabled="resetPasswordLoading" @click="handleResetPassword"><span v-if="resetPasswordLoading" class="i-svg-spinners-90-ring-with-bg text-xs" /><span v-else>确认修改</span></button></div>
    </div></div>
  </Transition></Teleport>
</div>
</template>

<style scoped>
.pg {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  padding: 24px;
  background-image: url('/bg-desktop.webp');
  background-size: cover;
  background-position: center;
  background-attachment: fixed;
  background-repeat: no-repeat;
}

@media (max-width: 768px) {
  .pg {
    background-image: url('/bg-mobile.webp');
  }
}

.pg::before {
  content: '';
  position: absolute;
  inset: 0;
  background: transparent;
  pointer-events: none;
}

/* 液态玻璃主卡片 */
.liquid-login-card {
  position: relative;
  z-index: 10;
  width: 100%;
  max-width: 440px;
  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(28px) saturate(190%);
  -webkit-backdrop-filter: blur(28px) saturate(190%);
  border: 1.5px solid rgba(255, 255, 255, 0.85);
  border-radius: 28px;
  padding: 44px 38px 36px;
  box-shadow:
    inset 0 1.5px 2px rgba(255, 255, 255, 0.95),
    0 24px 60px rgba(15, 23, 42, 0.16),
    0 4px 16px rgba(0, 0, 0, 0.08);
}

@keyframes cardFloat {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}

.card-glow {
  position: absolute;
  inset: 0;
  border-radius: 28px;
  pointer-events: none;
  background: radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 0.5) 0%, transparent 60%);
}

.logo-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 24px;
}

.login-logo-img {
  max-width: 310px;
  width: 90%;
  height: auto;
  object-fit: contain;
  transition: transform 0.3s ease;
}

.login-logo-img:hover {
  transform: scale(1.04);
}

.tag {
  text-align: center;
  font-size: 0.82rem;
  font-weight: 600;
  color: #475569;
  letter-spacing: 0.05em;
}

/* 液态切换选项卡 */
.tabs {
  display: flex;
  gap: 6px;
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 16px;
  padding: 5px;
  margin-bottom: 24px;
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.8);
}

.tb {
  flex: 1;
  padding: 9px 0;
  border: none;
  border-radius: 12px;
  font-size: 0.88rem;
  font-weight: 700;
  color: #64748b;
  background: transparent;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  letter-spacing: 0.06em;
}

.tb-on {
  background: rgba(255, 255, 255, 0.85);
  color: #2563eb;
  border: 1px solid rgba(255, 255, 255, 0.95);
  box-shadow:
    inset 0 1px 1.5px rgba(255, 255, 255, 1),
    0 4px 14px rgba(37, 99, 235, 0.15);
}

.fm { display: flex; flex-direction: column; gap: 18px; }
.fld { display: flex; flex-direction: column; gap: 6px; }

/* 液态输入框 */
.inp {
  position: relative;
  display: flex;
  align-items: center;
}

.inp-ico {
  position: absolute;
  left: 16px;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent !important;
  box-shadow: none !important;
  border: none !important;
  padding: 0 !important;
  margin: 0 !important;
  width: auto !important;
  height: auto !important;
}

.inp-ico img {
  display: block;
  width: 18px;
  height: 18px;
  object-fit: contain;
  filter: brightness(0) !important;
  opacity: 1 !important;
}

.inp input {
  width: 100%;
  height: 50px;
  padding: 0 16px 0 46px;
  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(12px);
  border: 1.5px solid rgba(255, 255, 255, 0.85);
  border-radius: 9999px;
  font-size: 0.92rem;
  font-weight: 500;
  color: #1e293b;
  outline: none;
  box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.8), 0 2px 8px rgba(15, 23, 42, 0.03);
  transition: all 0.25s ease;
}

.inp input::placeholder { color: #94a3b8; }

.inp input:focus {
  background: rgba(255, 255, 255, 0.85);
  border-color: #3b82f6;
  box-shadow:
    inset 0 1px 2px rgba(255, 255, 255, 1),
    0 0 0 4px rgba(59, 130, 246, 0.18),
    0 8px 24px rgba(59, 130, 246, 0.12);
}



.input-hint { font-size: 0.74rem; color: #ef4444; padding-left: 6px; font-weight: 500; }

.pwd { display: flex; align-items: center; gap: 10px; }
.pwd-bar { flex: 1; height: 4px; background: rgba(255, 255, 255, 0.5); border-radius: 99px; overflow: hidden; }
.pwd-bar i { display: block; height: 100%; border-radius: 99px; transition: width 0.4s; }
.pwd small { font-size: 0.72rem; font-weight: 700; min-width: 44px; }

.gift { font-size: 0.82rem; font-weight: 600; color: #2563eb; background: none; border: none; cursor: pointer; padding: 4px 0; display: inline-flex; align-items: center; gap: 4px; width: fit-content; }
.gift:hover { text-decoration: underline; }

.nt { display: flex; align-items: flex-start; gap: 8px; padding: 12px 16px; border-radius: 14px; font-size: 0.82rem; line-height: 1.5; backdrop-filter: blur(10px); }
.nt-err { background: rgba(254, 242, 242, 0.85); color: #991b1b; border: 1px solid rgba(254, 202, 202, 0.9); }
.nt-ok { background: rgba(239, 246, 255, 0.85); color: #1e40af; border: 1px solid rgba(191, 219, 254, 0.9); }

/* 极光微光圆弧胶囊主提交按钮 (青绿到天蓝高光渐变) */
.btn {
  width: 100%;
  height: 52px;
  background: linear-gradient(120deg, #10b981 0%, #06b6d4 25%, #3b82f6 50%, #06b6d4 75%, #10b981 100%);
  background-size: 250% 100%;
  animation: aurora-flow 4s ease-in-out infinite;
  border: 1px solid rgba(255, 255, 255, 0.75);
  color: #ffffff;
  border-radius: 9999px;
  font-size: 1.02rem;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  letter-spacing: 0.1em;
  margin-top: 10px;
  box-shadow:
    inset 0 1.5px 2px rgba(255, 255, 255, 0.8),
    inset 0 -1.5px 2px rgba(0, 0, 0, 0.08),
    0 10px 28px -4px rgba(14, 165, 233, 0.45),
    0 4px 14px rgba(16, 185, 129, 0.3);
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
}

@keyframes aurora-flow {
  0% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
  100% {
    background-position: 0% 50%;
  }
}

.btn .btn-icon {
  font-size: 1.25rem;
  transition: transform 0.25s ease;
}

.btn:hover:not(:disabled) {
  transform: translateY(-2px) scale(1.01);
  box-shadow:
    inset 0 2px 3px rgba(255, 255, 255, 0.9),
    inset 0 -1.5px 2px rgba(0, 0, 0, 0.06),
    0 14px 30px -4px rgba(14, 165, 233, 0.55),
    0 6px 16px rgba(16, 185, 129, 0.35);
  filter: brightness(1.05);
}

.btn:hover:not(:disabled) .btn-icon {
  transform: translateX(3px);
}

.btn:active:not(:disabled) { transform: scale(0.98); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

.ft { margin-top: 24px; text-align: center; display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap; }
.ft span { font-size: 0.84rem; color: #475569; font-weight: 500; }
.ft a { font-size: 0.84rem; font-weight: 700; color: #2563eb; text-decoration: none; }
.ft a:hover { text-decoration: underline; }
.ft-div { font-size: 0.84rem; color: #94a3b8; }

.ver { margin-top: 18px; text-align: center; display: flex; align-items: center; justify-content: center; gap: 6px; }
.ver code { font-size: 0.7rem; color: #64748b; font-weight: 600; font-family: monospace; padding: 3px 12px; background: rgba(255, 255, 255, 0.5); border: 1px solid rgba(255, 255, 255, 0.7); border-radius: 99px; }

/* 模态弹窗 */
.md-bg { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; background: rgba(15, 23, 42, 0.4);  padding: 24px; }
.md-box { background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(24px); border: 1.5px solid rgba(255, 255, 255, 0.9); border-radius: 24px; padding: 36px 32px; max-width: 400px; width: 100%; text-align: center; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.2), inset 0 1px 2px rgba(255, 255, 255, 0.9); }
.md-ico { display: inline-flex; align-items: center; justify-content: center; width: 56px; height: 56px; border-radius: 18px; margin-bottom: 18px; border: 1px solid rgba(255, 255, 255, 0.8); }
.md-ok { background: rgba(219, 234, 254, 0.8); color: #2563eb; }
.md-err { background: rgba(254, 226, 226, 0.8); color: #ef4444; }
.md-box h3 { font-size: 1.15rem; font-weight: 700; color: #1e293b; margin-bottom: 8px; }
.md-box > p { font-size: 0.88rem; color: #475569; margin-bottom: 20px; }
.md-kc { background: rgba(255, 255, 255, 0.6); border: 1px solid rgba(255, 255, 255, 0.8); border-radius: 14px; padding: 14px; margin-bottom: 24px; }
.md-kc small { display: block; font-size: 0.72rem; color: #64748b; margin-bottom: 6px; }
.md-kc code { font-size: 0.92rem; font-weight: 700; color: #1e40af; font-family: monospace; }
.md-box button { width: 100%; height: 46px; background: linear-gradient(135deg, #3b82f6, #2563eb); border: 1px solid rgba(255, 255, 255, 0.5); color: #fff; border-radius: 14px; font-size: 0.9rem; font-weight: 700; cursor: pointer; box-shadow: 0 6px 18px rgba(37, 99, 235, 0.3); }
.md-acts { display: flex; gap: 12px; margin-top: 20px; }
.md-cancel { background: rgba(241, 245, 249, 0.8) !important; color: #475569 !important; border: 1px solid rgba(255, 255, 255, 0.6) !important; }
.md-confirm { height: 46px !important; }
.fade-enter-active,.fade-leave-active { transition: opacity 0.25s ease; }
.fade-enter-from,.fade-leave-to { opacity: 0; }
</style>
