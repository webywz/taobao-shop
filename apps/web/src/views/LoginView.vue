<script setup lang="ts">
import { ref } from "vue"
import { useRouter } from "vue-router"
import { ElMessage } from "element-plus"
import { adminLogin } from "../lib/api"

const router = useRouter()
const loading = ref(false)
const username = ref("")
const password = ref("")

async function handleLogin() {
  if (!username.value.trim() || !password.value) {
    ElMessage.warning("请输入账号和密码")
    return
  }
  loading.value = true
  try {
    await adminLogin({
      username: username.value.trim(),
      password: password.value
    })
    ElMessage.success("登录成功")
    await router.replace("/admin/codes")
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "登录失败")
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-[70vh] flex items-center justify-center">
    <div class="w-full max-w-md bg-white rounded-xl shadow border border-gray-200 p-6">
      <h1 class="text-xl font-semibold text-gray-900 mb-1">后台登录</h1>
      <p class="text-sm text-gray-500 mb-5">登录后可访问后台管理接口。</p>
      <form class="space-y-4" @submit.prevent="handleLogin">
        <div>
          <label class="block text-sm text-gray-700 mb-1">账号</label>
          <input
            v-model="username"
            type="text"
            autocomplete="username"
            class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label class="block text-sm text-gray-700 mb-1">密码</label>
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          type="submit"
          :disabled="loading"
          class="w-full bg-blue-600 text-white rounded-md py-2 hover:bg-blue-700 disabled:opacity-60"
        >
          {{ loading ? "登录中..." : "登录" }}
        </button>
      </form>
    </div>
  </div>
</template>
