<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api'

const router = useRouter()
const username = ref('')
const cardCode = ref('')
const loading = ref(false)
const error = ref('')
const success = ref('')

async function handleRenew() {
  if (!username.value) { error.value = '请输入用户名'; return }
  if (!cardCode.value) { error.value = '请输入卡密'; return }

  loading.value = true; error.value = ''; success.value = ''
  try {
    const res = await api.post('/api/public/renew', { username: username.value, cardCode: cardCode.value })
    if (res.data.ok) {
      const cardType = res.data.data.cardType
      const card = res.data.data.card
      if (cardType === 'quota') { success.value = '续费成功！账号额度已增加' }
      else { const expiresAt = new Date(card.expiresAt); success.value = `续费成功！有效期至 ${expiresAt.toLocaleString('zh-CN')}` }
      setTimeout(() => { router.push('/login') }, 2000)
    } else { error.value = res.data.error || '续费失败' }
  } catch (e: any) {
    const data = e.response?.data
    if (data?.errorType === 'rate_limit') { error.value = data.error || '请求过于频繁' }
    else { error.value = data?.error || e.message || '续费失败' }
  } finally { loading.value = false }
}

function goBack() { router.push('/login') }
</script>

<template>
<div class="pg">
  <div class="bg">
    <div class="bg-ring r1" /><div class="bg-ring r2" /><div class="bg-ring r3" />
    <span class="bg-dot" style="top:12%;left:8%;--d:0s" />
    <span class="bg-dot" style="top:28%;right:12%;--d:-2s" />
    <span class="bg-dot" style="bottom:32%;left:18%;--d:-4s" />
    <span class="bg-dot" style="top:55%;right:22%;--d:-6s" />
    <span class="bg-dot" style="bottom:18%;right:8%;--d:-3s" />
    <span class="bg-dot" style="top:70%;left:6%;--d:-5s" />
    <span class="bg-dot" style="top:35%;left:50%;--d:-7s" />
    <div class="bg-scan" />
  </div>

  <div class="card">
    <div class="card-glow" />
    <div class="ico-box"><div class="ico-inner"><div class="i-carbon-renew ico-main" /></div></div>
    <h1>账号续费</h1>
    <p class="tag">输入用户名和卡密，延长账号有效期</p>

    <form class="fm" @submit.prevent="handleRenew">
      <div class="fld">
        <div class="inp">
          <span class="inp-ico"><div class="i-carbon-user" /></span>
          <input v-model="username" type="text" placeholder="用户名" autocomplete="username">
          <span class="inp-line" />
        </div>
      </div>
      <div class="fld">
        <div class="inp">
          <span class="inp-ico"><div class="i-carbon-license" /></span>
          <input v-model="cardCode" type="text" placeholder="卡密">
          <span class="inp-line" />
        </div>
      </div>
      <div v-if="error" class="nt nt-err"><span class="i-carbon-warning-alt" />{{ error }}</div>
      <div v-if="success" class="nt nt-ok"><span class="i-carbon-checkmark-outline" />{{ success }}</div>
      <button type="submit" class="btn" :disabled="loading">
        <span v-if="loading" class="i-svg-spinners-90-ring-with-bg" /><span v-else>立即续费</span>
      </button>
    </form>

    <p class="ft">
      <a href="#" @click.prevent="goBack">返回登录</a>
    </p>
  </div>
</div>
</template>

<style scoped>
.pg { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #eff6ff; position: relative; overflow: hidden; padding: 24px; }
.bg { position: absolute; inset: 0; pointer-events: none; }
.bg-ring { position: absolute; border-radius: 50%; border: 1px solid; animation: rSpin 30s linear infinite; }
.r1 { width: 800px; height: 800px; top: -20%; left: calc(50% - 400px); border-color: rgba(59,130,246,.06); }
.r2 { width: 550px; height: 550px; top: 8%; left: calc(50% - 275px); border-color: rgba(59,130,246,.1); animation-duration: 24s; animation-direction: reverse; }
.r3 { width: 320px; height: 320px; top: 28%; left: calc(50% - 160px); border-color: rgba(59,130,246,.15); animation-duration: 18s; }
@keyframes rSpin { to { transform: rotate(360deg); } }
.bg-dot { position: absolute; width: 6px; height: 6px; background: rgba(59,130,246,.35); border-radius: 50%; box-shadow: 0 0 12px rgba(59,130,246,.25); animation: dotDrift 8s ease-in-out infinite; animation-delay: var(--d); }
@keyframes dotDrift { 0%,100% { opacity: .25; transform: translateY(0); } 50% { opacity: .65; transform: translateY(-36px); } }
.bg-scan { position: absolute; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, rgba(59,130,246,.15), transparent); animation: scanDown 7s linear infinite; }
@keyframes scanDown { 0% { top: -10%; opacity: 0; } 5% { opacity: 1; } 95% { opacity: 1; } 100% { top: 110%; opacity: 0; } }
.card { position: relative; z-index: 1; width: 100%; max-width: 420px; background: rgba(255,255,255,.9); backdrop-filter: blur(24px); border: 1px solid rgba(59,130,246,.1); border-radius: 20px; padding: 44px 36px 36px; box-shadow: 0 1px 3px rgba(59,130,246,.04), 0 8px 40px rgba(59,130,246,.08), 0 0 80px rgba(59,130,246,.04); animation: cardUp 6s ease-in-out infinite; }
@keyframes cardUp { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
.card-glow { position: absolute; inset: -1px; border-radius: 20px; z-index: -1; background: linear-gradient(135deg, rgba(59,130,246,.1), transparent 45%, transparent 55%, rgba(59,130,246,.1)); animation: gShift 4s ease-in-out infinite; }
@keyframes gShift { 0%,100% { opacity: .4; } 50% { opacity: 1; } }
.ico-box { text-align: center; margin-bottom: 24px; }
.ico-inner { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 72px; height: 72px; border-radius: 50%; background: linear-gradient(135deg, #dbeafe, #eff6ff); }
.ico-inner::before { content: ''; position: absolute; inset: -5px; border-radius: 50%; border: 2px solid rgba(59,130,246,.2); animation: ringOut 2.5s ease-out infinite; }
.ico-inner::after { content: ''; position: absolute; inset: -10px; border-radius: 50%; border: 1px solid rgba(59,130,246,.1); animation: ringOut 2.5s ease-out .7s infinite; }
@keyframes ringOut { 0% { transform: scale(1); opacity: 1; } 100% { transform: scale(1.5); opacity: 0; } }
.ico-main { font-size: 2rem; color: #3b82f6; animation: icoGl 2s ease-in-out infinite; }
@keyframes icoGl { 0%,100% { filter: drop-shadow(0 0 4px rgba(59,130,246,.2)); } 50% { filter: drop-shadow(0 0 14px rgba(59,130,246,.45)); } }
h1 { text-align: center; font-size: 1.35rem; font-weight: 700; color: #1e3a5f; margin-bottom: 4px; letter-spacing: .02em; }
.tag { text-align: center; font-size: .78rem; color: #94a3b8; letter-spacing: .1em; margin-bottom: 28px; }
.fm { display: flex; flex-direction: column; gap: 18px; }
.fld { display: flex; flex-direction: column; gap: 6px; }
.inp { position: relative; display: flex; align-items: center; }
.inp-ico { position: absolute; left: 14px; color: #93c5fd; font-size: .95rem; pointer-events: none; display: flex; transition: color .25s; }
.inp:focus-within .inp-ico { color: #3b82f6; }
.inp input { width: 100%; height: 48px; padding: 0 16px 0 42px; background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 12px; font-size: .875rem; color: #1e293b; outline: none; transition: border-color .25s, box-shadow .25s, background .25s; }
.inp input::placeholder { color: #cbd5e1; }
.inp input:focus { border-color: #3b82f6; background: #fff; box-shadow: 0 0 0 4px rgba(59,130,246,.08), 0 0 20px rgba(59,130,246,.06); }
.inp-line { position: absolute; bottom: 0; left: 12px; right: 12px; height: 1px; background: linear-gradient(90deg, transparent, rgba(59,130,246,.5), transparent); opacity: 0; transition: opacity .3s; }
.inp:focus-within .inp-line { opacity: 1; }
.nt { display: flex; align-items: flex-start; gap: 8px; padding: 11px 14px; border-radius: 10px; font-size: .78rem; line-height: 1.5; }
.nt-err { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
.nt-ok { background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; }
.btn { width: 100%; height: 48px; background: linear-gradient(135deg, #3b82f6, #2563eb); color: #fff; border: none; border-radius: 12px; font-size: .92rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: transform .15s, box-shadow .25s, filter .25s; letter-spacing: .12em; margin-top: 4px; box-shadow: 0 4px 16px rgba(59,130,246,.25), 0 0 24px rgba(59,130,246,.1); position: relative; overflow: hidden; }
.btn::after { content: ''; position: absolute; inset: 0; border-radius: 12px; background: linear-gradient(135deg, transparent 40%, rgba(255,255,255,.1) 50%, transparent 60%); background-size: 200% 100%; animation: bShine 3s infinite; }
@keyframes bShine { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
.btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 6px 24px rgba(59,130,246,.35), 0 0 36px rgba(59,130,246,.18); filter: brightness(1.05); }
.btn:active:not(:disabled) { transform: scale(.97); } .btn:disabled { opacity: .45; cursor: not-allowed; }
.ft { margin-top: 24px; text-align: center; }
.ft a { font-size: .82rem; font-weight: 600; color: #3b82f6; text-decoration: none; }
.ft a:hover { color: #2563eb; }
@media (max-width: 520px) { .card { padding: 32px 22px 28px; } h1 { font-size: 1.2rem; } .ico-inner { width: 56px; height: 56px; } .ico-main { font-size: 1.5rem; } }
</style>
