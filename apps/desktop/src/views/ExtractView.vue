<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { CreateTasksBatchResponse } from '@tb-pdd-image/shared'
import { createTasksBatch, getStoredLicenseToken } from '../lib/api'

const sourceUrls = ref('')
const message = ref<string | null>(null)
const loading = ref(false)
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

async function handleCreate() {
  if (!getStoredLicenseToken()) {
    message.value = "请先完成卡密激活"
    ElMessage.warning(message.value)
    return
  }

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
    ElMessage.success(`创建完成：成功 ${result.successCount} 条，失败 ${result.failedCount} 条`)
  } catch (error) {
    message.value = error instanceof Error ? error.message : "批量创建任务失败"
    ElMessage.error(message.value)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-6xl py-8">
    <div class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 class="text-2xl font-semibold tracking-tight text-gray-950">批量提取商品图片</h2>
        <p class="mt-2 text-sm text-gray-600">
          一行一个链接，提交后浏览器插件会自动处理队列。
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

          <div class="mt-5">
            <button
              type="submit"
              :disabled="!canSubmit"
              class="inline-flex h-10 cursor-pointer items-center justify-center rounded-md bg-blue-600 px-5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {{ loading ? "创建中..." : `创建 ${parsedUrls.valid.length} 个任务` }}
            </button>
          </div>
        </form>
      </section>

      <aside class="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h3 class="text-base font-semibold text-gray-950">执行设置</h3>
        <p class="mt-2 text-sm text-gray-600">
          并发抓取由浏览器插件执行。桌面端负责批量创建任务，插件并发数请在 Web 页面同步到插件。
        </p>
        <div class="mt-5 rounded-md bg-gray-50 px-3 py-2">
          <div class="text-sm font-medium text-gray-900">默认并发</div>
          <div class="mt-1 text-2xl font-semibold text-gray-950">3</div>
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
