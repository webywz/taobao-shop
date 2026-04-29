<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { Task } from '@tb-pdd-image/shared'
import { listTasks } from '../lib/api'
import { ElMessage } from 'element-plus'

const tasks = ref<Task[]>([])
const error = ref<string | null>(null)
const loading = ref(true)

function formatStatus(status: Task["status"]) {
  switch (status) {
    case "pending":
      return "待执行"
    case "claimed":
      return "已领取"
    case "running":
      return "执行中"
    case "uploading":
      return "上传中"
    case "completed":
      return "已完成"
    case "failed":
      return "失败"
    case "expired":
      return "已过期"
    default:
      return status
  }
}

function getStatusColor(status: Task["status"]) {
  switch (status) {
    case "completed":
      return "bg-green-100 text-green-800"
    case "failed":
    case "expired":
      return "bg-red-100 text-red-800"
    case "pending":
    case "claimed":
      return "bg-gray-100 text-gray-800"
    case "running":
    case "uploading":
      return "bg-blue-100 text-blue-800"
    default:
      return "bg-gray-100 text-gray-800"
  }
}

onMounted(async () => {
  try {
    const payload = await listTasks()
    tasks.value = payload.items
  } catch (loadError) {
    error.value = loadError instanceof Error ? loadError.message : "获取历史任务失败"
    ElMessage.error(error.value)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="max-w-5xl mx-auto py-8">
    <div class="bg-white shadow sm:rounded-lg overflow-hidden">
      <div class="px-4 py-5 sm:p-6">
        <h3 class="text-lg leading-6 font-medium text-gray-900 mb-1">
          📜 历史任务
        </h3>
        <p class="text-sm text-gray-500 mb-6">
          进入单个任务可查看详细分类结果、归档状态和后续转换动作。
        </p>

        <div v-if="loading" class="text-center py-12">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-4 border-gray-300 border-t-blue-600"></div>
          <p class="mt-2 text-sm text-gray-500">加载中...</p>
        </div>

        <div v-else-if="error" class="p-4 rounded-md bg-red-50 text-red-700 text-sm">
          {{ error }}
        </div>

        <div v-else-if="tasks.length === 0" class="text-center py-12 bg-gray-50 rounded-lg border border-gray-200 border-dashed">
          <div class="text-4xl mb-3">📭</div>
          <h3 class="text-sm font-medium text-gray-900">当前还没有历史任务</h3>
          <p class="mt-1 text-sm text-gray-500">先去提取页创建一个商品链接任务，结果会自动回到这里。</p>
          <div class="mt-6">
            <router-link
              to="/extract"
              class="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              创建任务
            </router-link>
          </div>
        </div>

        <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <router-link
            v-for="task in tasks"
            :key="task.taskId"
            :to="`/tasks/${task.taskId}`"
            class="relative rounded-lg border border-gray-300 bg-white px-6 py-5 shadow-sm flex items-center space-x-3 hover:border-blue-400 focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-blue-500 transition-colors"
          >
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between mb-2">
                <p class="text-sm font-medium text-gray-900 truncate">
                  {{ task.title ?? '未命名任务' }}
                </p>
                <span
                  class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                  :class="getStatusColor(task.status)"
                >
                  {{ formatStatus(task.status) }}
                </span>
              </div>
              <div class="flex items-center gap-2 text-xs text-gray-500 mb-2 flex-wrap">
                <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                  平台: {{ task.platform || '未知' }}
                </span>
                <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                  主图: {{ task.counts?.main ?? 0 }}
                </span>
                <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                  详情: {{ task.counts?.detail ?? 0 }}
                </span>
                <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                  其他: {{ task.counts?.other ?? 0 }}
                </span>
              </div>
              <p class="text-xs text-gray-400 truncate" :title="task.taskId">
                {{ task.taskId }}
              </p>
            </div>
          </router-link>
        </div>
      </div>
    </div>
  </div>
</template>
