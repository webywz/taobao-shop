<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { clearStoredAdminToken } from '../lib/api'

const route = useRoute()
const router = useRouter()
const isLoginPage = computed(() => route.path === '/login')

function handleLogout() {
  clearStoredAdminToken()
  router.replace('/login')
}
</script>

<template>
  <div class="min-h-screen bg-gray-50 flex flex-col font-sans">
    <header class="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between h-16">
          <div class="flex">
            <div class="flex-shrink-0 flex items-center gap-2">
              <span class="text-xl">⚡</span>
              <span class="text-lg font-bold text-gray-900">ImageFlow Admin</span>
            </div>
            <nav v-if="!isLoginPage" class="hidden sm:ml-8 sm:flex sm:space-x-8">
              <router-link
                to="/admin/codes"
                class="inline-flex items-center px-1 pt-1 text-sm font-medium"
                :class="route.path.startsWith('/admin/codes') ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700 hover:border-gray-300'"
              >
                <span class="mr-1">🗝️</span> 卡密管理
              </router-link>
              <router-link
                to="/install-plugin"
                class="inline-flex items-center px-1 pt-1 text-sm font-medium"
                :class="route.path.startsWith('/install-plugin') ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700 hover:border-gray-300'"
              >
                <span class="mr-1">🧩</span> 插件
              </router-link>
              <router-link
                to="/extract"
                class="inline-flex items-center px-1 pt-1 text-sm font-medium"
                :class="route.path.startsWith('/extract') ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700 hover:border-gray-300'"
              >
                <span class="mr-1">📦</span> 提取
              </router-link>
              <router-link
                to="/tasks"
                class="inline-flex items-center px-1 pt-1 text-sm font-medium"
                :class="route.path.startsWith('/tasks') ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700 hover:border-gray-300'"
              >
                <span class="mr-1">📋</span> 历史
              </router-link>
            </nav>
          </div>
          <div v-if="!isLoginPage" class="flex items-center">
            <button
              class="text-sm text-gray-500 hover:text-gray-700"
              @click="handleLogout"
            >
              退出登录
            </button>
          </div>
        </div>
      </div>
    </header>
    
    <main class="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <slot></slot>
    </main>
  </div>
</template>
