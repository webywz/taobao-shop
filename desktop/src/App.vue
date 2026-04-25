<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";

type TaskStatus = "pending" | "running" | "completed" | "failed";

type SkuItem = {
  name: string;
  image?: string;
};

type TaskResult = {
  title?: string;
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

type DownloadTarget = "selected" | "all" | "main" | "color" | "detail" | "video";

type DownloadAssetsResult = {
  saved_dir: string;
  main_count: number;
  color_count: number;
  detail_count: number;
  video_count: number;
  record_path?: string | null;
};

type DownloadOptions = {
  includeMain: boolean;
  includeColor: boolean;
  includeDetail: boolean;
  includeVideo: boolean;
  writeRecord: boolean;
  dedupeColor: boolean;
  enableTaobao: boolean;
  enableTmall: boolean;
};

const DOWNLOAD_OPTIONS_KEY = "tbTaui.download-options.v2";

function loadDownloadOptions(): DownloadOptions {
  const defaults: DownloadOptions = {
    includeMain: true,
    includeColor: true,
    includeDetail: true,
    includeVideo: true,
    writeRecord: true,
    dedupeColor: true,
    enableTaobao: true,
    enableTmall: true,
  };

  try {
    const raw = localStorage.getItem(DOWNLOAD_OPTIONS_KEY);
    if (!raw) return defaults;
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

const url = ref("");
const tasks = ref<Task[]>([]);
const selectedTask = ref<Task | null>(null);
const loading = ref(false);
const backendOk = ref(false);
const createError = ref("");
const downloadTarget = ref<DownloadTarget | null>(null);
const downloadMessage = ref("");
const downloadError = ref("");
const recordMessage = ref("");
const lastSavedDir = ref("");
const downloadOptions = reactive(loadDownloadOptions());
let pollTimer: number | undefined;
let listTimer: number | undefined;

watch(
  downloadOptions,
  value => {
    localStorage.setItem(DOWNLOAD_OPTIONS_KEY, JSON.stringify(value));
  },
  { deep: true }
);

const runningCount = computed(() => tasks.value.filter(t => t.status === "running" || t.status === "pending").length);
const selectedResult = computed(() => selectedTask.value?.result ?? null);
const selectedDownloadCount = computed(() => {
  return [
    downloadOptions.includeMain,
    downloadOptions.includeColor,
    downloadOptions.includeDetail,
    downloadOptions.includeVideo,
    downloadOptions.writeRecord
  ].filter(Boolean).length;
});

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

function validateUrlBySiteSwitch(input: string) {
  try {
    const parsed = new URL(input);
    const host = parsed.hostname.toLowerCase();
    if (host.includes("tmall.com") && !downloadOptions.enableTmall) {
      return "当前已关闭新版天猫采集";
    }
    if (host.includes("taobao.com") && !host.includes("tmall.com") && !downloadOptions.enableTaobao) {
      return "当前已关闭新版淘宝采集";
    }
    return "";
  } catch {
    return "链接格式不正确";
  }
}

async function createTask() {
  const inputUrl = url.value.trim();
  if (!inputUrl) return;

  createError.value = validateUrlBySiteSwitch(inputUrl);
  if (createError.value) return;

  loading.value = true;
  try {
    const res = await invoke<{ task_id: string }>("backend_request", {
      method: "POST",
      path: "/tasks",
      body: { url: inputUrl },
    });
    url.value = "";
    await fetchTasks();
    const task = tasks.value.find(t => t.id === res.task_id) ?? null;
    selectedTask.value = task;
    startPoll(res.task_id);
  } catch (e) {
    createError.value = e instanceof Error ? e.message : "创建任务失败";
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
  recordMessage.value = "";
}

function statusColor(s: TaskStatus) {
  return { pending: "#f59e0b", running: "#3b82f6", completed: "#22c55e", failed: "#ef4444" }[s] ?? "#94a3b8";
}

function statusLabel(s: TaskStatus) {
  return { pending: "等待中", running: "采集中", completed: "已完成", failed: "失败" }[s] ?? s;
}

function downloadLabel(target: DownloadTarget) {
  return {
    selected: `按勾选下载 (${selectedDownloadCount.value})`,
    all: "下载全部资源",
    main: "下载主图",
    color: "下载颜色图",
    detail: "下载详情图",
    video: "下载视频"
  }[target];
}

function getDownloadCount(result: DownloadAssetsResult, target: DownloadTarget) {
  if (target === "selected" || target === "all") {
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
    selected:
      (downloadOptions.includeMain && Boolean(result.images?.length)) ||
      (downloadOptions.includeColor && Boolean(result.color_images?.length)) ||
      (downloadOptions.includeDetail && Boolean(result.detail_images?.length)) ||
      (downloadOptions.includeVideo && Boolean(result.video_url)) ||
      downloadOptions.writeRecord,
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

function getDownloadFlags(target: DownloadTarget) {
  if (target === "selected") {
    return {
      includeMain: downloadOptions.includeMain,
      includeColor: downloadOptions.includeColor,
      includeDetail: downloadOptions.includeDetail,
      includeVideo: downloadOptions.includeVideo,
      writeRecord: downloadOptions.writeRecord,
      dedupeColor: downloadOptions.dedupeColor
    };
  }

  return {
    includeMain: target === "all" || target === "main",
    includeColor: target === "all" || target === "color",
    includeDetail: target === "all" || target === "detail",
    includeVideo: target === "all" || target === "video",
    writeRecord: downloadOptions.writeRecord,
    dedupeColor: downloadOptions.dedupeColor
  };
}

async function handleDownload(target: DownloadTarget) {
  if (!selectedTask.value?.result) return;

  const flags = getDownloadFlags(target);
  if (!flags.includeMain && !flags.includeColor && !flags.includeDetail && !flags.includeVideo && !flags.writeRecord) {
    downloadError.value = "请至少勾选一个下载项或记录";
    return;
  }

  downloadTarget.value = target;
  downloadMessage.value = "";
  downloadError.value = "";
  recordMessage.value = "";
  lastSavedDir.value = "";

  try {
    const result = await invoke<DownloadAssetsResult>("download_assets", {
      input: {
        task_id: selectedTask.value.id,
        source_url: selectedTask.value.url,
        title: selectedTask.value.result.title ?? null,
        target,
        main_images: selectedTask.value.result.images ?? [],
        color_images: selectedTask.value.result.color_images ?? [],
        detail_images: selectedTask.value.result.detail_images ?? [],
        video_url: selectedTask.value.result.video_url ?? null,
        include_main: flags.includeMain,
        include_color: flags.includeColor,
        include_detail: flags.includeDetail,
        include_video: flags.includeVideo,
        dedupe_color: flags.dedupeColor,
        write_record: flags.writeRecord
      }
    });

    downloadMessage.value = `已保存 ${getDownloadCount(result, target)} 个文件到 ${result.saved_dir}`;
    lastSavedDir.value = result.saved_dir;
    if (result.record_path) {
      recordMessage.value = `记录文件已生成：${result.record_path}`;
    }
  } catch (error) {
    downloadError.value = error instanceof Error ? error.message : "下载失败";
  } finally {
    downloadTarget.value = null;
  }
}

async function openSavedDir() {
  if (!lastSavedDir.value) return;
  try {
    await invoke("open_path", { path: lastSavedDir.value });
  } catch (error) {
    downloadError.value = error instanceof Error ? error.message : "打开目录失败";
  }
}

function formatDate(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleString("zh-CN", { hour12: false });
}

function escapeCsv(value: unknown) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(objectUrl);
}

function exportTaskRecords() {
  if (!tasks.value.length) {
    recordMessage.value = "暂无可导出的记录";
    return;
  }

  const header = ["任务ID", "链接", "标题", "状态", "主图数", "颜色图数", "详情图数", "视频", "更新时间"];
  const rows = tasks.value.map(task => [
    task.id,
    task.url,
    task.result?.title ?? "",
    statusLabel(task.status),
    task.result?.images?.length ?? 0,
    task.result?.color_images?.length ?? 0,
    task.result?.detail_images?.length ?? 0,
    task.result?.video_url ? "有" : "无",
    formatDate(task.updated_at)
  ]);
  const content = [header, ...rows].map(row => row.map(escapeCsv).join(",")).join("\n");
  downloadTextFile(`tbTaui-records-${Date.now()}.csv`, content, "text/csv;charset=utf-8");
  recordMessage.value = "采集清单已导出为 CSV";
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
      <div v-if="createError" class="error-box">{{ createError }}</div>

      <div class="task-list-header">
        任务列表
        <span v-if="runningCount" class="running-badge">{{ runningCount }} 运行中</span>
        <button class="btn-link" :disabled="!tasks.length" @click="exportTaskRecords">导出记录</button>
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
            <div class="option-panel">
              <div class="option-title">下载选项</div>
              <div class="option-grid">
                <label class="option-item">
                  <input v-model="downloadOptions.includeMain" type="checkbox" />
                  <span>主图</span>
                </label>
                <label class="option-item">
                  <input v-model="downloadOptions.includeColor" type="checkbox" />
                  <span>颜色</span>
                </label>
                <label class="option-item">
                  <input v-model="downloadOptions.includeDetail" type="checkbox" />
                  <span>详情</span>
                </label>
                <label class="option-item">
                  <input v-model="downloadOptions.includeVideo" type="checkbox" />
                  <span>主图视频</span>
                </label>
                <label class="option-item">
                  <input v-model="downloadOptions.writeRecord" type="checkbox" />
                  <span>记录</span>
                </label>
                <label class="option-item">
                  <input v-model="downloadOptions.dedupeColor" type="checkbox" />
                  <span>过滤重复颜色</span>
                </label>
              </div>
              <div class="site-grid">
                <label class="option-item">
                  <input v-model="downloadOptions.enableTaobao" type="checkbox" />
                  <span>新版淘宝</span>
                </label>
                <label class="option-item">
                  <input v-model="downloadOptions.enableTmall" type="checkbox" />
                  <span>新版天猫</span>
                </label>
              </div>
            </div>
            <div class="action-row">
              <button class="btn-primary" :disabled="!hasMedia('selected') || !!downloadTarget" @click="handleDownload('selected')">
                {{ isDownloading("selected") ? "下载中..." : downloadLabel("selected") }}
              </button>
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

          <div v-if="downloadMessage" class="success-box success-row">
            <span>{{ downloadMessage }}</span>
            <button v-if="lastSavedDir" class="btn-secondary" @click="openSavedDir">打开保存目录</button>
          </div>
          <div v-if="recordMessage" class="hint-box">{{ recordMessage }}</div>
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
