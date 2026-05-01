<script setup lang="ts">
</script>

<template>
  <div class="max-w-5xl mx-auto py-12">
    <div class="text-center mb-12">
      <div class="text-sm font-medium text-amber-600 mb-2">💡 Quick Help</div>
      <h1 class="text-4xl font-bold text-gray-900 mb-4">先按流程走，再做排查</h1>
      <p class="text-xl text-gray-500">激活 → 安装插件 → 创建任务 → 查看结果。</p>
    </div>

    <div class="grid grid-cols-1 gap-6 sm:grid-cols-3">
      <div class="bg-white overflow-hidden shadow sm:rounded-lg">
        <div class="px-4 py-5 sm:p-6 text-center">
          <div class="text-3xl mb-3">🔑 01</div>
          <h3 class="text-lg font-medium text-gray-900 mb-2">先激活卡密</h3>
          <p class="text-sm text-gray-500">生成当前浏览器授权。</p>
        </div>
      </div>

      <div class="bg-white overflow-hidden shadow sm:rounded-lg">
        <div class="px-4 py-5 sm:p-6 text-center">
          <div class="text-3xl mb-3">🧩 02</div>
          <h3 class="text-lg font-medium text-gray-900 mb-2">再安装插件</h3>
          <p class="text-sm text-gray-500">加载解压后的插件目录。</p>
        </div>
      </div>

      <div class="bg-white overflow-hidden shadow sm:rounded-lg">
        <div class="px-4 py-5 sm:p-6 text-center">
          <div class="text-3xl mb-3">📦 03</div>
          <h3 class="text-lg font-medium text-gray-900 mb-2">创建任务后自动执行</h3>
          <p class="text-sm text-gray-500">插件无需绑定，收到任务后会直接执行。</p>
        </div>
      </div>
    </div>
  </div>
</template>
