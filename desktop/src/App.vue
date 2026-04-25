<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { computed, onMounted, onUnmounted, ref } from "vue";

type TaskStatus = "pending" | "running" | "completed" | "failed";

type TaskResult = {
  title?: string;
  price_text?: string;
  shop_name?: string;
  images?: string[];
  skus?: object[];
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


const url = ref("");
const tasks = ref<Task[]>([]);
const selectedTask = ref<Task | null>(null);
const loading = ref(false);
const backendOk = ref(false);
let pollTimer: number | undefined;
let listTimer: number | undefined;

const runningCount = computed(() => tasks.value.filter(t => t.status === "running" || t.status === "pending").length);

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
}

function statusColor(s: TaskStatus) {
  return { pending: "#f59e0b", running: "#3b82f6", completed: "#22c55e", failed: "#ef4444" }[s] ?? "#94a3b8";
}

function statusLabel(s: TaskStatus) {
  return { pending: "等待中", running: "采集中", completed: "已完成", failed: "失败" }[s] ?? s;
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
          </div>

          <div v-if="selectedTask.result.images?.length" class="images-grid">
            <img
              v-for="(img, i) in selectedTask.result.images.slice(0, 6)"
              :key="i"
              :src="img"
              class="thumb"
            />
          </div>
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
