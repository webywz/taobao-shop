<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { createTask } from '../lib/api'
import { getPluginStatus, pingPlugin, triggerPluginPoll } from '../lib/plugin-bridge'

const router = useRouter()
const sourceUrl = ref('')
const message = ref<string | null>(null)
const loading = ref(false)

async function handleCreate() {
  const normalizedUrl = sourceUrl.value.trim()

  if (!normalizedUrl) {
    message.value = "请输入商品链接"
    ElMessage.warning(message.value)
    return
  }

  loading.value = true
  message.value = null

  try {
    const result = await createTask({
      sourceUrl: normalizedUrl
    })

    try {
      await triggerPluginPoll()
    } catch {
      // The task is already created. Do not block navigation if the plugin does not respond.
    }

    ElMessage.success('创建任务成功')
    router.push(`/tasks/${result.taskId}`)
  } catch (error) {
    message.value = error instanceof Error ? error.message : "创建任务失败"
    ElMessage.error(message.value)
  } finally {
    loading.value = false
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
</script>

<template>
  <div class="max-w-3xl mx-auto py-8">
    <div class="bg-white shadow sm:rounded-lg overflow-hidden">
      <div class="px-4 py-5 sm:p-6">
        <h3 class="text-lg leading-6 font-medium text-gray-900 mb-1">
          📦 提取商品图片
        </h3>
        <p class="text-sm text-gray-500 mb-6">
          输入商品链接，创建提取任务，插件将自动在后台进行处理。
        </p>

        <form class="space-y-4" @submit.prevent="handleCreate">
          <div>
            <label for="source-url" class="block text-sm font-medium text-gray-700">商品链接</label>
            <div class="mt-1">
              <input
                type="text"
                name="source-url"
                id="source-url"
                class="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md py-3 px-4 border"
                placeholder="https://item.taobao.com/item.htm?id=123456"
                v-model="sourceUrl"
              />
            </div>
          </div>

          <div class="flex items-center gap-3 pt-2">
            <button
              type="submit"
              :disabled="loading"
              class="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {{ loading ? "创建中..." : "开始提取" }}
            </button>
            <button
              type="button"
              @click="handlePluginStatus"
              class="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              检查插件状态
            </button>
          </div>
        </form>

        <div class="mt-6 flex items-center gap-2 text-xs text-gray-500">
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full font-medium bg-blue-100 text-blue-800">
            支持淘宝 / 天猫
          </span>
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full font-medium bg-gray-100 text-gray-800">
            创建任务后立即通知插件拉取
          </span>
        </div>

        <div v-if="message" class="mt-4 p-4 rounded-md bg-gray-50 text-gray-700 text-sm border border-gray-200">
          {{ message }}
        </div>
      </div>
    </div>
  </div>
</template>
