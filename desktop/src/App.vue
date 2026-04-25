<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { computed, onMounted, onUnmounted, ref } from "vue";

type TaskStatus = "pending" | "running" | "completed" | "failed";

type SkuItem = {
  name: string;
  image?: string;
};

type TaskResult = {
  title?: string;
  price_text?: string;
  shop_name?: string;
  images?: string[];
  video_url?: string | null;
  color_images?: string[];
  detail_images?: string[];
  skus?: SkuItem[];
};

type Task = {
  id: string;
  url: string;
  status: TaskStatus;
  created_at: number;
  updated_at: number;
  result?: TaskResult;
  error_message?: string;
};

type DownloadTarget = "all" | "main" | "color" | "detail" | "video";

type DownloadAssetsResult = {
  saved_dir: string;
  main_count: number;
  color_count: number;
  detail_count: number;
  video_count: number;
};

const url = ref("");
const tasks = ref<Task[]>([]);
const selectedTask = ref<Task | null>(null);
const loading = ref(false);
const backendOk = ref(false);
const downloadTarget = ref<DownloadTarget | null>(null);
const downloadMessage = ref("");
const downloadError = ref("");
let pollTimer: number | undefined;
let listTimer: number | undefined;

const runningCount = computed(() => tasks.value.filter(t => t.status === "running" || t.status === "pending").length);
const selectedResult = computed(() => selectedTask.value?.result ?? null);

async function checkHealth() {
  try {
    await invoke<object>("backend_request", { method: "GET", path: "/health", body: null });
    backendOk.value = true;
  } catch {
    backendOk.value = false;
  }
}

async function fetchTasks() {
  try {
    const data = await invoke<{ tasks: Task[] }>("backend_request", { method: "GET", path: "/tasks", body: null });
    tasks.value = data.tasks;
  } catch {}
}

async function createTask() {
  if (!url.value.trim()) return;
  loading.value = true;
  try {
    const res = await invoke<{ task_id: string }>("backend_request", {
      method: "POST",
      path: "/tasks",
      body: { url: url.value.trim() },
    });
    url.value = "";
    await fetchTasks();
    const task = tasks.value.find(t => t.id === res.task_id) ?? null;
    selectedTask.value = task;
    startPoll(res.task_id);
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
}

async function deleteTask(id: string) {
  await invoke("backend_request", { method: "DELETE", path: `/tasks/${id}`, body: null });
  if (selectedTask.value?.id === id) selectedTask.value = null;
  await fetchTasks();
}

function startPoll(taskId: string) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = window.setInterval(async () => {
    try {
      const task = await invoke<Task>("backend_request", { method: "GET", path: `/tasks/${taskId}`, body: null });
      selectedTask.value = task;
      await fetchTasks();
      if (task.status === "completed" || task.status === "failed") {
        clearInterval(pollTimer);
      }
    } catch {
      clearInterval(pollTimer);
    }
  }, 1500);
}

function selectTask(task: Task) {
  selectedTask.value = task;
  downloadMessage.value = "";
  downloadError.value = "";
}

function statusColor(s: TaskStatus) {
  return { pending: "#f59e0b", running: "#3b82f6", completed: "#22c55e", failed: "#ef4444" }[s] ?? "#94a3b8";
}

function statusLabel(s: TaskStatus) {
  return { pending: "等待中", running: "采集中", completed: "已完成", failed: "失败" }[s] ?? s;
}

function downloadLabel(target: DownloadTarget) {
  return {
    all: "下载全部资源",
    main: "下载主图",
    color: "下载颜色图",
    detail: "下载详情图",
    video: "下载视频"
  }[target];
}

function getDownloadCount(result: DownloadAssetsResult, target: DownloadTarget) {
  if (target === "all") {
    return result.main_count + result.color_count + result.detail_count + result.video_count;
  }

  return {
    main: result.main_count,
    color: result.color_count,
    detail: result.detail_count,
    video: result.video_count
  }[target];
}

function hasMedia(target: DownloadTarget) {
  const result = selectedResult.value;
  if (!result) return false;

  return {
    all:
      Boolean(result.images?.length) ||
      Boolean(result.color_images?.length) ||
      Boolean(result.detail_images?.length) ||
      Boolean(result.video_url),
    main: Boolean(result.images?.length),
    color: Boolean(result.color_images?.length),
    detail: Boolean(result.detail_images?.length),
    video: Boolean(result.video_url)
  }[target];
}

function isDownloading(target: DownloadTarget) {
  return downloadTarget.value === target;
}

async function handleDownload(target: DownloadTarget) {
  if (!selectedTask.value?.result) return;

  downloadTarget.value = target;
  downloadMessage.value = "";
  downloadError.value = "";

  try {
    const result = await invoke<DownloadAssetsResult>("download_assets", {
      input: {
        task_id: selectedTask.value.id,
        title: selectedTask.value.result.title ?? null,
        target,
        main_images: selectedTask.value.result.images ?? [],
        color_images: selectedTask.value.result.color_images ?? [],
        detail_images: selectedTask.value.result.detail_images ?? [],
        video_url: selectedTask.value.result.video_url ?? null
      }
    });

    downloadMessage.value = `已保存 ${getDownloadCount(result, target)} 个文件到 ${result.saved_dir}`;
  } catch (error) {
    downloadError.value = error instanceof Error ? error.message : "下载失败";
  } finally {
    downloadTarget.value = null;
  }
}

onMounted(async () => {
  try { await invoke("ensure_backend"); } catch {}
  await checkHealth();
  await fetchTasks();
  listTimer = window.setInterval(fetchTasks, 3000);
});

onUnmounted(() => {
  clearInterval(pollTimer);
  clearInterval(listTimer);
});
</script>

<template>
  <div class="app">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-icon">🛒</span>
        <span class="brand-name">淘宝采集</span>
        <span class="badge" :class="backendOk ? 'badge-ok' : 'badge-err'">
          {{ backendOk ? "已连接" : "未连接" }}
        </span>
      </div>

      <div class="input-group">
        <input
          v-model="url"
          class="url-input"
          placeholder="粘贴淘宝商品链接..."
          @keydown.enter="createTask"
        />
        <button class="btn-primary" :disabled="loading || !url.trim()" @click="createTask">
          {{ loading ? "..." : "采集" }}
        </button>
      </div>

      <div class="task-list-header">
        任务列表
        <span v-if="runningCount" class="running-badge">{{ runningCount }} 运行中</span>
      </div>

      <div class="task-list">
        <div
          v-for="task in tasks"
          :key="task.id"
          class="task-item"
          :class="{ active: selectedTask?.id === task.id }"
          @click="selectTask(task)"
        >
          <div class="task-item-top">
            <span class="status-dot" :style="{ background: statusColor(task.status) }"></span>
            <span class="task-status">{{ statusLabel(task.status) }}</span>
            <button class="btn-del" @click.stop="deleteTask(task.id)">×</button>
          </div>
          <div class="task-url">{{ task.url }}</div>
        </div>
        <div v-if="!tasks.length" class="empty">暂无任务</div>
      </div>
    </aside>

    <main class="detail">
      <template v-if="selectedTask">
        <div class="detail-header">
          <span class="status-pill" :style="{ background: statusColor(selectedTask.status) }">
            {{ statusLabel(selectedTask.status) }}
          </span>
          <span class="detail-id">{{ selectedTask.id }}</span>
        </div>

        <div class="detail-url">{{ selectedTask.url }}</div>

        <template v-if="selectedTask.result">
          <div class="result-card">
            <div class="result-title">{{ selectedTask.result.title ?? "—" }}</div>
            <div class="result-row">
              <span class="result-label">价格</span>
              <span class="result-value price">{{ selectedTask.result.price_text ?? "—" }}</span>
            </div>
            <div class="result-row">
              <span class="result-label">店铺</span>
              <span class="result-value">{{ selectedTask.result.shop_name ?? "—" }}</span>
            </div>
            <div class="result-row">
              <span class="result-label">主图</span>
              <span class="result-value">{{ selectedTask.result.images?.length || 0 }} 张</span>
            </div>
            <div class="result-row">
              <span class="result-label">主图视频</span>
              <span class="result-value">{{ selectedTask.result.video_url ? "已抓取" : "无" }}</span>
            </div>
            <div class="result-row">
              <span class="result-label">颜色图片</span>
              <span class="result-value">{{ selectedTask.result.color_images?.length || 0 }} 张</span>
            </div>
            <div class="result-row">
              <span class="result-label">详情图片</span>
              <span class="result-value">{{ selectedTask.result.detail_images?.length || 0 }} 张</span>
            </div>
            <div class="action-row">
              <button class="btn-secondary" :disabled="!hasMedia('all') || !!downloadTarget" @click="handleDownload('all')">
                {{ isDownloading("all") ? "下载中..." : downloadLabel("all") }}
              </button>
              <button class="btn-secondary" :disabled="!hasMedia('main') || !!downloadTarget" @click="handleDownload('main')">
                {{ isDownloading("main") ? "下载中..." : downloadLabel("main") }}
              </button>
              <button class="btn-secondary" :disabled="!hasMedia('color') || !!downloadTarget" @click="handleDownload('color')">
                {{ isDownloading("color") ? "下载中..." : downloadLabel("color") }}
              </button>
              <button class="btn-secondary" :disabled="!hasMedia('detail') || !!downloadTarget" @click="handleDownload('detail')">
                {{ isDownloading("detail") ? "下载中..." : downloadLabel("detail") }}
              </button>
              <button class="btn-secondary" :disabled="!hasMedia('video') || !!downloadTarget" @click="handleDownload('video')">
                {{ isDownloading("video") ? "下载中..." : downloadLabel("video") }}
              </button>
            </div>
          </div>

          <div v-if="downloadMessage" class="success-box">{{ downloadMessage }}</div>
          <div v-if="downloadError" class="error-box">{{ downloadError }}</div>

          <section v-if="selectedTask.result.images?.length" class="media-section">
            <div class="media-header">
              <div>
                <div class="media-title">主图</div>
                <div class="media-meta">{{ selectedTask.result.images.length }} 张</div>
              </div>
              <a class="link-btn" :href="selectedTask.result.images[0]" target="_blank" rel="noreferrer">打开首张</a>
            </div>
            <div class="images-grid">
              <a
                v-for="(img, i) in selectedTask.result.images"
                :key="`main-${i}`"
                :href="img"
                target="_blank"
                rel="noreferrer"
                class="media-link"
              >
                <img :src="img" class="thumb" />
              </a>
            </div>
          </section>

          <section v-if="selectedTask.result.color_images?.length" class="media-section">
            <div class="media-header">
              <div>
                <div class="media-title">颜色图</div>
                <div class="media-meta">{{ selectedTask.result.color_images.length }} 张</div>
              </div>
            </div>
            <div class="images-grid">
              <a
                v-for="(img, i) in selectedTask.result.color_images"
                :key="`color-${i}`"
                :href="img"
                target="_blank"
                rel="noreferrer"
                class="media-link"
              >
                <img :src="img" class="thumb" />
              </a>
            </div>
          </section>

          <section v-if="selectedTask.result.skus?.length" class="media-section">
            <div class="media-header">
              <div>
                <div class="media-title">SKU 识别</div>
                <div class="media-meta">{{ selectedTask.result.skus.length }} 条</div>
              </div>
            </div>
            <div class="sku-grid">
              <div v-for="(sku, i) in selectedTask.result.skus" :key="`sku-${i}`" class="sku-card">
                <img v-if="sku.image" :src="sku.image" class="sku-thumb" />
                <div class="sku-name">{{ sku.name }}</div>
              </div>
            </div>
          </section>

          <section v-if="selectedTask.result.detail_images?.length" class="media-section">
            <div class="media-header">
              <div>
                <div class="media-title">详情图</div>
                <div class="media-meta">{{ selectedTask.result.detail_images.length }} 张</div>
              </div>
            </div>
            <div class="images-grid detail-grid">
              <a
                v-for="(img, i) in selectedTask.result.detail_images"
                :key="`detail-${i}`"
                :href="img"
                target="_blank"
                rel="noreferrer"
                class="media-link"
              >
                <img :src="img" class="thumb detail-thumb" />
              </a>
            </div>
          </section>

          <section v-if="selectedTask.result.video_url" class="media-section">
            <div class="media-header">
              <div>
                <div class="media-title">主图视频</div>
                <div class="media-meta">支持在线播放与下载</div>
              </div>
              <a class="link-btn" :href="selectedTask.result.video_url" target="_blank" rel="noreferrer">打开视频地址</a>
            </div>
            <video class="video-player" :src="selectedTask.result.video_url" controls preload="metadata"></video>
          </section>
        </template>

        <div v-if="selectedTask.error_message" class="error-box">
          {{ selectedTask.error_message }}
        </div>

        <div v-if="selectedTask.status === 'pending' || selectedTask.status === 'running'" class="hint-box">
          请在 Chrome 中安装采集插件，插件将自动打开页面并抓取数据
        </div>
      </template>

      <div v-else class="empty-detail">
        <div class="empty-icon">🔍</div>
        <div>选择左侧任务查看详情，或输入链接开始采集</div>
      </div>
    </main>
  </div>
</template>
