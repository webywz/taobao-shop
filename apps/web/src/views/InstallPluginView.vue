<script setup lang="ts">
import { ref } from 'vue'
import { getPluginStatus, pingPlugin } from '../lib/plugin-bridge'

const message = ref<string | null>(null)
const checking = ref(false)

async function handleCheck() {
  checking.value = true

  try {
    const ping = await pingPlugin()

    if (!ping.installed) {
      message.value = "插件没有响应，请先下载插件包并在 Chrome 扩展管理页完成安装。"
      return
    }

    const status = await getPluginStatus()
    message.value = status.ready
      ? `✅ 插件已安装，版本 ${ping.version ?? "-"}，设备 ${status.deviceId ?? "-"} 已就绪`
      : `⚠️ 插件已安装，版本 ${ping.version ?? "-"}，正在准备设备身份`
  } catch {
    message.value = "当前页面没有收到插件响应。请确认已开启开发者模式，并加载了解压后的插件目录。"
  } finally {
    checking.value = false
  }
}
</script>

<template>
  <div class="max-w-4xl mx-auto py-12">
    <div class="text-center mb-12">
      <div class="text-sm font-medium text-blue-600 mb-2">🧩 Step 02</div>
      <h1 class="text-4xl font-bold text-gray-900 mb-4">安装插件并完成检测</h1>
      <p class="text-xl text-gray-500">下载 ZIP，加载到 Chrome 扩展管理页，然后回到这里检测。</p>
    </div>

    <div class="bg-white shadow sm:rounded-lg overflow-hidden">
      <div class="px-4 py-5 sm:p-6 border-b border-gray-200">
        <h3 class="text-lg leading-6 font-medium text-gray-900">
          🔌 Plugin
        </h3>
        <p class="mt-1 text-sm text-gray-500">
          安装并检测扩展。下载 ZIP，加载目录，回到页面检测插件是否就绪。
        </p>
      </div>

      <div class="px-4 py-5 sm:p-6">
        <div class="flex flex-wrap gap-3 mb-8">
          <a
            href="/downloads/tb-image-extension.zip"
            download
            class="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
          >
            📥 下载插件包
          </a>
          <button
            @click="handleCheck"
            :disabled="checking"
            class="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            {{ checking ? "检测中..." : "🔍 检测插件" }}
          </button>
        </div>

        <ul class="space-y-4 mb-6">
          <li class="flex items-start gap-3">
            <div class="flex-shrink-0 h-6 w-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-xs mt-0.5">1</div>
            <div>
              <h4 class="text-sm font-medium text-gray-900">下载解压</h4>
              <p class="text-sm text-gray-500">下载并解压，保留 <code>chrome-mv3-prod</code> 目录。</p>
            </div>
          </li>
          <li class="flex items-start gap-3">
            <div class="flex-shrink-0 h-6 w-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-xs mt-0.5">2</div>
            <div>
              <h4 class="text-sm font-medium text-gray-900">加载插件</h4>
              <p class="text-sm text-gray-500">打开 <code>chrome://extensions</code>，开启开发者模式，加载已解压目录。</p>
            </div>
          </li>
          <li class="flex items-start gap-3">
            <div class="flex-shrink-0 h-6 w-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-xs mt-0.5">3</div>
            <div>
              <h4 class="text-sm font-medium text-gray-900">检测插件</h4>
              <p class="text-sm text-gray-500">回到页面检测插件是否已就绪。</p>
            </div>
          </li>
        </ul>

        <div v-if="message" class="p-4 rounded-md bg-gray-50 border border-gray-200 text-gray-700 text-sm">
          {{ message }}
        </div>
      </div>
    </div>
  </div>
</template>
