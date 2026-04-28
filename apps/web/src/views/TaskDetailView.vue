<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import type { Task } from '@tb-pdd-image/shared'
import { convertAsset, convertTask, getTask, requestArchive } from '../lib/api'
import { ElMessage } from 'element-plus'

const route = useRoute()
const taskId = computed(() => route.params.taskId as string)

const task = ref<Task | null>(null)
const error = ref<string | null>(null)
// const actionMessage = ref<string | null>(null)
const brokenAssetIds = ref<string[]>([])
const selectedAsset = ref<any>(null)
const showPreview = ref(false)
const currentPreviewIndex = ref(0)

const allAssets = computed(() => {
  if (!task.value || !task.value.assets) return []
  return [
    ...(task.value.assets.main || []),
    ...(task.value.assets.detail || []),
    ...(task.value.assets.other || [])
  ]
})

const terminalStatuses = new Set(["completed", "failed", "expired"])
let timer: number | undefined

function formatStatus(status: Task["status"]) {
  switch (status) {
    case "pending": return "待执行"
    case "claimed": return "已领取"
    case "running": return "执行中"
    case "uploading": return "上传中"
    case "completed": return "已完成"
    case "failed": return "失败"
    case "expired": return "已过期"
    default: return status
  }
}

async function load() {
  try {
    const nextTask = await getTask(taskId.value)
    task.value = nextTask
    error.value = null

    if (!terminalStatuses.has(nextTask.status)) {
      timer = window.setTimeout(load, 2000)
    }
  } catch (loadError) {
    error.value = loadError instanceof Error ? loadError.message : "获取任务失败"
  }
}

async function handleArchive(retentionDays: 3 | 7 | 30) {
  try {
    await requestArchive(taskId.value, retentionDays)
    const nextTask = await getTask(taskId.value)
    task.value = nextTask
    ElMessage.success(`✅ ZIP 已生成，保留 ${retentionDays} 天`)
  } catch (archiveError) {
    ElMessage.error(archiveError instanceof Error ? archiveError.message : "ZIP 生成失败")
  }
}

async function handleConvertMain() {
  try {
    const result = await convertTask(taskId.value, {
      assetType: "main",
      targetFormat: "webp",
      retentionDays: 7
    })
    ElMessage.success(`✅ 主图转换任务已创建，共 ${String(result.jobCount)} 张`)
  } catch (convertError) {
    ElMessage.error(convertError instanceof Error ? convertError.message : "主图转换失败")
  }
}

async function handleConvertFirstAsset() {
  if (!task.value || !task.value.assets?.main?.length) {
    ElMessage.warning("当前没有可转换的主图")
    return
  }
  const firstAsset = task.value.assets.main[0]

  try {
    await convertAsset(firstAsset.assetId, {
      targetFormat: "png",
      retentionDays: 7
    })
    ElMessage.success(`✅ 已为 ${firstAsset.assetId} 创建单图转换任务`)
  } catch (convertError) {
    ElMessage.error(convertError instanceof Error ? convertError.message : "单图转换失败")
  }
}

function markAssetBroken(assetId: string) {
  if (!brokenAssetIds.value.includes(assetId)) {
    brokenAssetIds.value.push(assetId)
  }
}

function openPreview(asset: any) {
  const index = allAssets.value.findIndex(a => a.assetId === asset.assetId)
  if (index !== -1) {
    currentPreviewIndex.value = index
    selectedAsset.value = asset
    showPreview.value = true
  }
}

function prevImage() {
  if (currentPreviewIndex.value > 0) {
    currentPreviewIndex.value--
    selectedAsset.value = allAssets.value[currentPreviewIndex.value]
  }
}

function nextImage() {
  if (currentPreviewIndex.value < allAssets.value.length - 1) {
    currentPreviewIndex.value++
    selectedAsset.value = allAssets.value[currentPreviewIndex.value]
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (!showPreview.value) return
  if (e.key === 'ArrowLeft') prevImage()
  if (e.key === 'ArrowRight') nextImage()
  if (e.key === 'Escape') showPreview.value = false
}

onMounted(() => {
  load()
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  if (timer) {
    window.clearTimeout(timer)
  }
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div class="max-w-7xl mx-auto py-8">
    <div v-if="error" class="p-4 rounded-md bg-red-50 text-red-700 mb-6">
      {{ error }}
    </div>

    <div v-else-if="!task" class="text-center py-12">
      <div class="inline-block animate-spin rounded-full h-8 w-8 border-4 border-gray-300 border-t-blue-600"></div>
      <p class="mt-2 text-sm text-gray-500">任务加载中...</p>
    </div>

    <div v-else class="space-y-6">
      <div class="bg-white shadow sm:rounded-lg overflow-hidden">
        <div class="px-4 py-5 sm:px-6 flex justify-between items-center border-b border-gray-200">
          <div>
            <h3 class="text-lg leading-6 font-medium text-gray-900">
              任务详情
            </h3>
            <p class="mt-1 max-w-2xl text-sm text-gray-500">
              {{ task.title || taskId }}
            </p>
          </div>
          <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
            {{ formatStatus(task.status) }}
          </span>
        </div>
        <div class="px-4 py-5 sm:p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 class="text-sm font-medium text-gray-500 mb-2">基本信息</h4>
            <dl class="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
              <div class="sm:col-span-1">
                <dt class="text-sm font-medium text-gray-500">来源平台</dt>
                <dd class="mt-1 text-sm text-gray-900">{{ task.platform }}</dd>
              </div>
              <div class="sm:col-span-1">
                <dt class="text-sm font-medium text-gray-500">商品 ID</dt>
                <dd class="mt-1 text-sm text-gray-900">{{ task.productId || '-' }}</dd>
              </div>
              <div class="sm:col-span-2">
                <dt class="text-sm font-medium text-gray-500">来源链接</dt>
                <dd class="mt-1 text-sm text-gray-900 truncate">
                  <a :href="task.sourceUrl" target="_blank" class="text-blue-600 hover:underline">{{ task.sourceUrl }}</a>
                </dd>
              </div>
            </dl>
          </div>
          
          <div>
            <h4 class="text-sm font-medium text-gray-500 mb-2">提取统计</h4>
            <div class="flex gap-4">
              <div class="bg-gray-50 px-4 py-3 rounded-lg flex-1 text-center">
                <div class="text-2xl font-semibold text-gray-900">{{ task.counts?.main || 0 }}</div>
                <div class="text-xs text-gray-500 mt-1">主图</div>
              </div>
              <div class="bg-gray-50 px-4 py-3 rounded-lg flex-1 text-center">
                <div class="text-2xl font-semibold text-gray-900">{{ task.counts?.detail || 0 }}</div>
                <div class="text-xs text-gray-500 mt-1">详情图</div>
              </div>
              <div class="bg-gray-50 px-4 py-3 rounded-lg flex-1 text-center">
                <div class="text-2xl font-semibold text-gray-900">{{ task.counts?.other || 0 }}</div>
                <div class="text-xs text-gray-500 mt-1">其他图</div>
              </div>
            </div>
          </div>
        </div>
        
        <div class="px-4 py-4 sm:px-6 bg-gray-50 border-t border-gray-200 flex flex-wrap gap-3">
          <button @click="handleArchive(7)" class="inline-flex items-center px-3 py-1.5 border border-gray-300 shadow-sm text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50">
            打包下载 (保留7天)
          </button>
          <button @click="handleConvertMain" class="inline-flex items-center px-3 py-1.5 border border-gray-300 shadow-sm text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50">
            转换主图为 WebP
          </button>
          <button @click="handleConvertFirstAsset" class="inline-flex items-center px-3 py-1.5 border border-gray-300 shadow-sm text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50">
            转换首张为 PNG
          </button>
        </div>
      </div>

      <div v-for="type in ['main', 'detail', 'other']" :key="type" class="bg-white shadow sm:rounded-lg overflow-hidden">
        <div class="px-4 py-5 sm:px-6 border-b border-gray-200">
          <h3 class="text-lg leading-6 font-medium text-gray-900">
            {{ type === 'main' ? '主图' : type === 'detail' ? '详情图' : '其他图' }} 
            <span class="text-sm text-gray-500 ml-2">({{ task.assets?.[type as keyof typeof task.assets]?.length || 0 }})</span>
          </h3>
        </div>
        <div class="p-4">
          <div v-if="!task.assets?.[type as keyof typeof task.assets]?.length" class="text-center py-8 text-sm text-gray-500">
            暂无{{ type === 'main' ? '主图' : type === 'detail' ? '详情图' : '其他图' }}
          </div>
          <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            <div v-for="asset in task.assets[type as keyof typeof task.assets]" :key="asset.assetId" class="border border-gray-200 rounded-lg overflow-hidden flex flex-col">
              <div class="aspect-w-1 aspect-h-1 bg-gray-100 relative group">
                <div v-if="brokenAssetIds.includes(asset.assetId)" class="absolute inset-0 flex items-center justify-center text-xs text-gray-400">
                  图片加载失败
                </div>
                <img 
                  v-else
                  :src="asset.previewUrl || asset.sourceUrl" 
                  class="object-cover w-full h-full cursor-pointer"
                  @error="markAssetBroken(asset.assetId)"
                  @click="openPreview(asset)"
                />
              </div>
              <div class="p-2 text-xs border-t border-gray-200 bg-white">
                <div class="truncate font-medium" :title="asset.skuName || asset.assetId">{{ asset.skuName || '未命名' }}</div>
                <div class="text-gray-500 mt-1">{{ asset.width || '-' }} × {{ asset.height || '-' }}</div>
                <div class="mt-2">
                  <a :href="asset.sourceUrl" target="_blank" class="text-blue-600 hover:underline">打开原图 →</a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Image Preview Modal -->
    <div v-if="showPreview && selectedAsset" class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-90 p-4" @click="showPreview = false">
      <div class="relative w-full h-full flex items-center justify-center">
        <button class="absolute top-4 right-4 text-white text-3xl hover:text-gray-300 z-50" @click="showPreview = false">&times;</button>
        
        <button 
          v-if="currentPreviewIndex > 0" 
          class="absolute left-4 text-white text-5xl hover:text-gray-300 bg-black bg-opacity-50 w-12 h-12 rounded-full flex items-center justify-center z-50 focus:outline-none" 
          @click.stop="prevImage"
        >
          &lsaquo;
        </button>
        
        <img :src="selectedAsset.sourceUrl" class="max-w-full max-h-[90vh] object-contain" @click.stop />
        
        <button 
          v-if="currentPreviewIndex < allAssets.length - 1" 
          class="absolute right-4 text-white text-5xl hover:text-gray-300 bg-black bg-opacity-50 w-12 h-12 rounded-full flex items-center justify-center z-50 focus:outline-none" 
          @click.stop="nextImage"
        >
          &rsaquo;
        </button>
        
        <div class="absolute bottom-4 left-0 right-0 text-center text-white text-sm bg-black bg-opacity-50 py-2">
          {{ selectedAsset.skuName || selectedAsset.assetId }} ({{ selectedAsset.width || '-' }} × {{ selectedAsset.height || '-' }})
          <span class="ml-2 text-gray-400">{{ currentPreviewIndex + 1 }} / {{ allAssets.length }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
