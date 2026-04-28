<script setup lang="ts">
import { ref, computed } from 'vue'

type HomeStep = {
  id: string
  icon: string
  shortTitle: string
  title: string
  copy: string
  detail: string
  status: string
  href: string
  action: string
}

const steps: HomeStep[] = [
  {
    id: "01",
    icon: "🔑",
    shortTitle: "激活当前浏览器",
    title: "激活当前浏览器",
    copy: "输入卡密，生成当前浏览器可用的授权状态。",
    detail: "激活后会生成当前设备可用的 license_token，后续插件绑定和任务执行都基于这个状态。",
    status: "先完成授权绑定",
    href: "/activate",
    action: "去激活 →",
  },
  {
    id: "02",
    icon: "🧩",
    shortTitle: "安装插件并检测",
    title: "安装插件并完成检测",
    copy: "下载 ZIP，加载目录，然后回到页面检测并绑定。",
    detail: "插件安装成功后，浏览器才具备接收任务和执行图片提取的能力。",
    status: "确认插件在线",
    href: "/install-plugin",
    action: "安装插件 →",
  },
  {
    id: "03",
    icon: "📦",
    shortTitle: "创建提取任务",
    title: "输入链接，创建任务",
    copy: "任务创建后会立即通知插件执行。",
    detail: "支持淘宝、天猫链接。创建成功后，插件会按当前授权状态接手执行。",
    status: "提交待提取链接",
    href: "/extract",
    action: "创建任务 →",
  },
  {
    id: "04",
    icon: "📋",
    shortTitle: "查看历史结果",
    title: "所有执行结果汇总于此",
    copy: "统一查看任务状态、结果数量、详情与归档内容。",
    detail: "历史页负责统一回看任务状态和图片结果，也是后续排查异常的主入口。",
    status: "统一回看输出",
    href: "/tasks",
    action: "查看历史 →",
  },
]

const notes = [
  { icon: "📌", text: "建议顺序是先激活，再安装插件，再创建任务。" },
  { icon: "🔍", text: "如果插件没有响应，先回帮助页检查安装和绑定状态。" },
  { icon: "⚡", text: "日常使用通常只需要进入提取页和历史页。" },
]

const activeStepId = ref(steps[0].id)
const activeStep = computed(() => steps.find(s => s.id === activeStepId.value) ?? steps[0])
</script>

<template>
  <div class="max-w-4xl mx-auto py-8">
    <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-8">
      <div class="p-8 border-b border-gray-200 bg-gray-50/50">
        <div class="text-sm font-medium text-blue-600 mb-2">⚡ 商品图片提取台</div>
        <h1 class="text-3xl font-bold text-gray-900 mb-4">{{ activeStep.title }}</h1>
        <p class="text-xl text-gray-600 mb-4">{{ activeStep.copy }}</p>
        <p class="text-gray-500 mb-8">{{ activeStep.detail }}</p>
        <div class="flex items-center gap-4">
          <router-link
            :to="activeStep.href"
            class="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 transition-colors"
          >
            {{ activeStep.action }}
          </router-link>
          <span class="text-sm text-gray-500">{{ activeStep.status }}</span>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-gray-200">
        <button
          v-for="step in steps"
          :key="step.id"
          @click="activeStepId = step.id"
          class="p-6 text-left hover:bg-gray-50 transition-colors relative"
          :class="activeStepId === step.id ? 'bg-blue-50/50' : ''"
        >
          <div v-if="activeStepId === step.id" class="absolute top-0 left-0 w-full h-1 bg-blue-600 sm:w-1 sm:h-full sm:top-0"></div>
          <div class="text-sm text-gray-500 mb-2">{{ step.icon }} Step {{ step.id }}</div>
          <div class="font-medium text-gray-900 mb-1">{{ step.shortTitle }}</div>
          <div class="text-sm text-gray-500 line-clamp-2">{{ step.title }}</div>
        </button>
      </div>
    </div>

    <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
      <div class="mb-6">
        <div class="text-sm font-medium text-amber-600 mb-1">💡 Tips</div>
        <h2 class="text-xl font-bold text-gray-900">使用提醒</h2>
      </div>
      <ul class="space-y-4">
        <li v-for="item in notes" :key="item.text" class="flex items-start gap-3">
          <span class="flex-shrink-0 mt-0.5">{{ item.icon }}</span>
          <span class="text-gray-600">{{ item.text }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
