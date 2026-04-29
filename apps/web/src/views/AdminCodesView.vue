<script setup lang="ts">
import { onMounted, ref } from "vue"
import { ElMessage } from "element-plus"
import {
  type ActivationCodeRecord,
  generateActivationCodes,
  listActivationCodes
} from "../lib/api"

const loading = ref(false)
const tableLoading = ref(false)
const count = ref(10)
const durationDays = ref(30)
const batchNo = ref("")
const records = ref<ActivationCodeRecord[]>([])
const latestGenerated = ref<ActivationCodeRecord[]>([])

async function refreshCodes() {
  tableLoading.value = true
  try {
    const payload = await listActivationCodes(300)
    records.value = payload.items
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "获取卡密列表失败")
  } finally {
    tableLoading.value = false
  }
}

async function handleGenerate() {
  if (count.value < 1 || count.value > 1000) {
    ElMessage.warning("数量范围是 1-1000")
    return
  }
  if (durationDays.value < 1 || durationDays.value > 3650) {
    ElMessage.warning("有效天数范围是 1-3650")
    return
  }

  loading.value = true
  try {
    const payload = await generateActivationCodes({
      count: count.value,
      durationDays: durationDays.value,
      batchNo: batchNo.value.trim() || undefined
    })
    latestGenerated.value = payload.items
    await refreshCodes()
    ElMessage.success(`生成成功，共 ${payload.count} 条`)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "生成卡密失败")
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await refreshCodes()
})
</script>

<template>
  <div class="max-w-6xl mx-auto py-8 space-y-6">
    <div class="bg-white shadow sm:rounded-lg overflow-hidden">
      <div class="px-4 py-5 sm:p-6">
        <h3 class="text-lg leading-6 font-medium text-gray-900 mb-1">
          🗝️ 卡密生成
        </h3>
        <p class="text-sm text-gray-500 mb-6">
          只允许兑换已生成的卡密，卡密只能使用一次。
        </p>

        <form class="grid grid-cols-1 md:grid-cols-4 gap-4" @submit.prevent="handleGenerate">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">生成数量</label>
            <input
              v-model.number="count"
              type="number"
              min="1"
              max="1000"
              class="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md py-2 px-3 border"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">有效天数</label>
            <input
              v-model.number="durationDays"
              type="number"
              min="1"
              max="3650"
              class="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md py-2 px-3 border"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">批次号 (可选)</label>
            <input
              v-model="batchNo"
              type="text"
              placeholder="batch_20260429123000"
              class="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md py-2 px-3 border"
            />
          </div>
          <div class="flex items-end gap-3">
            <button
              type="submit"
              :disabled="loading"
              class="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60"
            >
              {{ loading ? "生成中..." : "生成卡密" }}
            </button>
            <button
              type="button"
              class="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              @click="refreshCodes"
            >
              刷新列表
            </button>
          </div>
        </form>
      </div>
    </div>

    <div v-if="latestGenerated.length" class="bg-white shadow sm:rounded-lg overflow-hidden">
      <div class="px-4 py-5 sm:p-6">
        <h4 class="text-base font-medium text-gray-900 mb-3">本次生成结果</h4>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          <div
            v-for="item in latestGenerated"
            :key="item.code"
            class="text-sm font-mono rounded border border-blue-100 bg-blue-50 text-blue-700 px-3 py-2"
          >
            {{ item.code }}
          </div>
        </div>
      </div>
    </div>

    <div class="bg-white shadow sm:rounded-lg overflow-hidden">
      <div class="px-4 py-5 sm:p-6">
        <h4 class="text-base font-medium text-gray-900 mb-3">卡密列表</h4>
        <div v-if="tableLoading" class="text-sm text-gray-500">加载中...</div>
        <div v-else class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">卡密</th>
                <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">有效天数</th>
                <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">批次</th>
                <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">创建时间</th>
                <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">兑换时间</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-100">
              <tr v-for="item in records" :key="`${item.code}-${item.createdAt}`">
                <td class="px-4 py-2 text-sm text-gray-900 font-mono">{{ item.code }}</td>
                <td class="px-4 py-2 text-sm">
                  <span
                    class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                    :class="item.status === 'redeemed' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'"
                  >
                    {{ item.status === "redeemed" ? "已兑换" : "未兑换" }}
                  </span>
                </td>
                <td class="px-4 py-2 text-sm text-gray-700">{{ item.durationDays }}</td>
                <td class="px-4 py-2 text-sm text-gray-700">{{ item.batchNo || "-" }}</td>
                <td class="px-4 py-2 text-sm text-gray-500">{{ item.createdAt || "-" }}</td>
                <td class="px-4 py-2 text-sm text-gray-500">{{ item.redeemedAt || "-" }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
