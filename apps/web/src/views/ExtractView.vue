<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { CreateTasksBatchResponse } from '@tb-pdd-image/shared'
import { createTasksBatch } from '../lib/api'
import {
  getConcurrencyConfig,
  getPluginStatus,
  pingPlugin,
  setConcurrencyConfig,
  triggerPluginPoll
} from '../lib/plugin-bridge'

const DEFAULT_CONCURRENCY = 3
const MIN_CONCURRENCY = 1
const MAX_CONCURRENCY = 5

const sourceUrls = ref('')
const message = ref<string | null>(null)
const concurrencyMessage = ref<string | null>(null)
const loading = ref(false)
const configLoading = ref(false)
const maxConcurrentTasks = ref(DEFAULT_CONCURRENCY)
const batchResult = ref<CreateTasksBatchResponse | null>(null)

function isSupportedSourceUrl(value: string) {
  try {
    const parsed = new URL(value)
    const hostname = parsed.hostname.toLowerCase()

    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (
        hostname === "m.tb.cn" ||
        hostname === "e.tb.cn" ||
        hostname === "taobao.com" ||
        hostname === "tmall.com" ||
        hostname.endsWith(".taobao.com") ||
        hostname.endsWith(".tmall.com")
      )
    )
  } catch {
    return false
  }
}

const parsedUrls = computed(() => {
  const rows = sourceUrls.value
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)
  const seen = new Set<string>()
  const valid: string[] = []
  const duplicate: string[] = []
  const invalid: string[] = []

  for (const row of rows) {
    if (seen.has(row)) {
      duplicate.push(row)
      continue
    }

    seen.add(row)

    if (isSupportedSourceUrl(row)) {
      valid.push(row)
    } else {
      invalid.push(row)
    }
  }

  return {
    rows,
    valid,
    duplicate,
    invalid
  }
})

const canSubmit = computed(() => parsedUrls.value.valid.length > 0 && !loading.value)

async function syncConcurrencyConfig() {
  configLoading.value = true
  concurrencyMessage.value = null

  try {
    const config = await getConcurrencyConfig()
    maxConcurrentTasks.value = config.maxConcurrentTasks
    concurrencyMessage.value = "已读取插件并发设置"
  } catch {
    concurrencyMessage.value = "未收到插件响应，并发设置暂未同步"
  } finally {
    configLoading.value = false
  }
}

async function handleSaveConcurrency() {
  configLoading.value = true
  concurrencyMessage.value = null

  try {
    const config = await setConcurrencyConfig(maxConcurrentTasks.value)
    maxConcurrentTasks.value = config.maxConcurrentTasks
    concurrencyMessage.value = `已同步到插件：${config.maxConcurrentTasks} 个任务并发`
    ElMessage.success(concurrencyMessage.value)
  } catch {
    concurrencyMessage.value = "插件未响应，任务仍可创建，但并发设置未同步"
    ElMessage.warning(concurrencyMessage.value)
  } finally {
    configLoading.value = false
  }
}

async function handlePluginStatus() {
  try {
    const ping = await pingPlugin()
    const status = await getPluginStatus()
    message.value = status.installed
      ? status.ready
        ? `插件已安装，版本 ${ping.version ?? "-"}，设备 ${status.deviceId ?? "-"} 已就绪`
        : `插件已安装，版本 ${ping.version ?? "-"}，正在准备设备身份`
      : "插件未安装"
    ElMessage.info(message.value)
  } catch {
    message.value = "未收到插件响应，请确认 content bridge 已注入当前页面"
    ElMessage.warning(message.value)
  }
}

async function handleCreate() {
  if (!parsedUrls.value.valid.length) {
    message.value = "请至少输入一条有效的淘宝或天猫商品链接"
    ElMessage.warning(message.value)
    return
  }

  loading.value = true
  message.value = null
  batchResult.value = null

  try {
    const result = await createTasksBatch({
      sourceUrls: parsedUrls.value.valid
    })
    batchResult.value = result

    if (result.successCount > 0) {
      try {
        await triggerPluginPoll()
      } catch {
        message.value = "任务已创建，但插件未响应；插件下次轮询会继续处理"
      }
    }

    const summary = `创建完成：成功 ${result.successCount} 条，失败 ${result.failedCount} 条`
    ElMessage.success(summary)
  } catch (error) {
    message.value = error instanceof Error ? error.message : "批量创建任务失败"
    ElMessage.error(message.value)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void syncConcurrencyConfig()
})
</script>

<template>
  <div class="mx-auto max-w-6xl py-8">
    <div class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 class="text-2xl font-semibold tracking-tight text-gray-950">批量提取商品图片</h2>
        <p class="mt-2 text-sm text-gray-600">
          一行一个链接，提交后插件会按并发设置自动处理队列。
        </p>
      </div>
      <router-link
        to="/tasks"
        class="inline-flex h-9 items-center justify-center rounded-md border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        查看历史任务
      </router-link>
    </div>

    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section class="rounded-lg border border-gray-200 bg-white shadow-sm">
        <form class="p-5 sm:p-6" @submit.prevent="handleCreate">
          <label for="source-urls" class="block text-sm font-medium text-gray-800">商品链接</label>
          <textarea
            id="source-urls"
            v-model="sourceUrls"
            rows="12"
            class="mt-2 block w-full resize-y rounded-md border border-gray-300 px-4 py-3 text-sm text-gray-950 shadow-sm outline-none transition-colors placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            placeholder="https://item.taobao.com/item.htm?id=123456&#10;https://detail.tmall.com/item.htm?id=654321"
          />

          <div class="mt-4 grid gap-3 text-sm sm:grid-cols-4">
            <div class="rounded-md bg-gray-50 px-3 py-2">
              <div class="font-semibold text-gray-950">{{ parsedUrls.rows.length }}</div>
              <div class="text-xs text-gray-500">已输入</div>
            </div>
            <div class="rounded-md bg-green-50 px-3 py-2">
              <div class="font-semibold text-green-700">{{ parsedUrls.valid.length }}</div>
              <div class="text-xs text-green-700/80">有效链接</div>
            </div>
            <div class="rounded-md bg-amber-50 px-3 py-2">
              <div class="font-semibold text-amber-700">{{ parsedUrls.duplicate.length }}</div>
              <div class="text-xs text-amber-700/80">重复忽略</div>
            </div>
            <div class="rounded-md bg-red-50 px-3 py-2">
              <div class="font-semibold text-red-700">{{ parsedUrls.invalid.length }}</div>
              <div class="text-xs text-red-700/80">无效链接</div>
            </div>
          </div>

          <div v-if="parsedUrls.invalid.length" class="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            有 {{ parsedUrls.invalid.length }} 条链接不属于淘宝或天猫，提交时会自动跳过。
          </div>

          <div class="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="submit"
              :disabled="!canSubmit"
              class="inline-flex h-10 cursor-pointer items-center justify-center rounded-md bg-blue-600 px-5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {{ loading ? "创建中..." : `创建 ${parsedUrls.valid.length} 个任务` }}
            </button>
            <button
              type="button"
              class="inline-flex h-10 cursor-pointer items-center justify-center rounded-md border border-gray-300 bg-white px-5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              @click="handlePluginStatus"
            >
              检查插件状态
            </button>
          </div>
        </form>
      </section>

      <aside class="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h3 class="text-base font-semibold text-gray-950">并发设置</h3>
        <p class="mt-2 text-sm text-gray-600">控制插件同时打开并抓取的任务数量。</p>

        <div class="mt-5">
          <label class="mb-2 block text-sm font-medium text-gray-800">同时抓取任务数</label>
          <el-input-number
            v-model="maxConcurrentTasks"
            :min="MIN_CONCURRENCY"
            :max="MAX_CONCURRENCY"
            :step="1"
            controls-position="right"
            class="w-full"
          />
        </div>

        <div class="mt-4 flex gap-2">
          <button
            type="button"
            :disabled="configLoading"
            class="inline-flex h-9 flex-1 cursor-pointer items-center justify-center rounded-md bg-gray-900 px-3 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            @click="handleSaveConcurrency"
          >
            保存到插件
          </button>
          <button
            type="button"
            :disabled="configLoading"
            class="inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            @click="syncConcurrencyConfig"
          >
            刷新
          </button>
        </div>

        <div v-if="concurrencyMessage" class="mt-4 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">
          {{ concurrencyMessage }}
        </div>
      </aside>
    </div>

    <section v-if="batchResult" class="mt-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 class="text-base font-semibold text-gray-950">创建结果</h3>
          <p class="mt-1 text-sm text-gray-600">
            成功 {{ batchResult.successCount }} 条，失败 {{ batchResult.failedCount }} 条。
          </p>
        </div>
        <router-link
          to="/tasks"
          class="inline-flex h-9 items-center justify-center rounded-md bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          打开历史任务
        </router-link>
      </div>

      <div v-if="batchResult.failedCount" class="mt-4 divide-y divide-red-100 rounded-md border border-red-200">
        <div
          v-for="item in batchResult.items.filter((entry) => !entry.success)"
          :key="item.sourceUrl"
          class="px-3 py-2 text-sm"
        >
          <div class="break-all font-medium text-red-700">{{ item.sourceUrl }}</div>
          <div class="mt-1 text-red-600">{{ item.errorMessage || "创建失败" }}</div>
        </div>
      </div>
    </section>

    <div v-if="message" class="mt-6 rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
      {{ message }}
    </div>
  </div>
</template>
