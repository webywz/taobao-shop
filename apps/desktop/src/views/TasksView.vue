<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { Task } from '@tb-pdd-image/shared'
import { listTasks } from '../lib/api'
import { ElMessage } from 'element-plus'

const tasks = ref<Task[]>([])
const error = ref<string | null>(null)
const loading = ref(true)

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "-"
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value))
}

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

function getTotalImages(task: Task) {
  return (
    (task.counts?.main ?? 0) +
    (task.counts?.sku ?? 0) +
    (task.counts?.detail ?? 0) +
    (task.counts?.other ?? 0)
  )
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
  <div class="max-w-6xl mx-auto py-8">
    <div class="space-y-6">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 class="text-2xl font-semibold tracking-tight text-gray-950">历史任务</h2>
          <p class="mt-2 text-sm text-gray-600">
            查看每次提取的分类结果、归档状态和后续转换动作。
          </p>
        </div>
        <router-link
          to="/extract"
          class="inline-flex h-9 items-center justify-center rounded-md bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          创建任务
        </router-link>
      </div>

      <div class="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div class="p-4 sm:p-6">
        <div v-if="loading" class="text-center py-12">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-4 border-gray-300 border-t-blue-600"></div>
          <p class="mt-2 text-sm text-gray-500">加载中...</p>
        </div>

        <div v-else-if="error" class="p-4 rounded-md bg-red-50 text-red-700 text-sm">
          {{ error }}
        </div>

        <div v-else-if="tasks.length === 0" class="text-center py-12 bg-gray-50 rounded-lg border border-gray-200 border-dashed">
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

        <div v-else class="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <router-link
            v-for="task in tasks"
            :key="task.taskId"
            :to="`/tasks/${task.taskId}`"
            class="group block rounded-lg border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <h3 class="truncate text-base font-semibold text-gray-950">
                  {{ task.title ?? '未命名任务' }}
                </h3>
                <p class="mt-1 truncate text-sm text-gray-500" :title="task.sourceUrl">
                  {{ task.sourceUrl }}
                </p>
              </div>
              <span
                class="shrink-0 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
                :class="getStatusColor(task.status)"
              >
                {{ formatStatus(task.status) }}
              </span>
            </div>

            <div class="mt-5 grid grid-cols-4 gap-2">
              <div class="rounded-md bg-gray-50 px-3 py-2 text-center">
                <div class="text-base font-semibold text-gray-950">{{ task.counts?.main ?? 0 }}</div>
                <div class="mt-0.5 text-xs text-gray-500">主图</div>
              </div>
              <div class="rounded-md bg-gray-50 px-3 py-2 text-center">
                <div class="text-base font-semibold text-gray-950">{{ task.counts?.sku ?? 0 }}</div>
                <div class="mt-0.5 text-xs text-gray-500">颜色</div>
              </div>
              <div class="rounded-md bg-gray-50 px-3 py-2 text-center">
                <div class="text-base font-semibold text-gray-950">{{ task.counts?.detail ?? 0 }}</div>
                <div class="mt-0.5 text-xs text-gray-500">详情</div>
              </div>
              <div class="rounded-md bg-gray-50 px-3 py-2 text-center">
                <div class="text-base font-semibold text-gray-950">{{ getTotalImages(task) }}</div>
                <div class="mt-0.5 text-xs text-gray-500">合计</div>
              </div>
            </div>

            <div class="mt-4 flex items-center justify-between border-t border-gray-100 pt-4 text-xs text-gray-500">
              <span>{{ task.platform || '未知平台' }}</span>
              <span>{{ formatDate(task.completedAt || task.createdAt) }}</span>
            </div>
          </router-link>
        </div>
        </div>
      </div>
    </div>
  </div>
</template>
