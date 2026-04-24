<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { computed, onMounted, onUnmounted, ref } from "vue";

type SessionStatus = {
  started: boolean;
  loggedIn: boolean;
  profileDir: string;
  lastCheckedAt?: string;
};

type CollectorBootstrap = {
  started: boolean;
  base_url: string;
};

type TaskStatus =
  | "created"
  | "queued"
  | "launching_browser"
  | "waiting_login"
  | "loading_page"
  | "extracting"
  | "normalizing"
  | "persisting"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

type TaskRecord = {
  id: string;
  sourceUrl: string;
  finalUrl?: string;
  status: TaskStatus;
  progress: number;
  result?: {
    title?: string;
    priceText?: string;
    shopName?: string;
    finalUrl?: string;
  };
  artifacts?: {
    debugDir?: string;
    screenshotPath?: string;
    pageHtmlPath?: string;
    resultJsonPath?: string;
    exportJsonPath?: string;
  };
  errorMessage?: string;
};

const collectorBase = ref("http://127.0.0.1:4318");
const productUrl = ref("https://item.taobao.com/item.htm?id=123456");
const loading = ref(false);
const sessionStatus = ref<SessionStatus | null>(null);
const currentTask = ref<TaskRecord | null>(null);
const message = ref("");

let pollTimer: number | undefined;

const canExport = computed(
  () => currentTask.value?.status === "completed" || currentTask.value?.status === "partial"
);

async function requestSessionStatus(): Promise<SessionStatus> {
  return invoke<SessionStatus>("collector_session_status", {
    base_url: collectorBase.value
  });
}

async function requestEnsureCollectorStarted(): Promise<CollectorBootstrap> {
  return invoke<CollectorBootstrap>("collector_ensure_started");
}

async function requestOpenLogin(): Promise<SessionStatus> {
  return invoke<SessionStatus>("collector_open_login", {
    base_url: collectorBase.value
  });
}

async function requestCreateTask(url: string): Promise<{ taskId: string; status: string }> {
  return invoke<{ taskId: string; status: string }>("collector_collect_product", {
    base_url: collectorBase.value,
    url
  });
}

async function requestTask(taskId: string): Promise<TaskRecord> {
  return invoke<TaskRecord>("collector_get_task", {
    base_url: collectorBase.value,
    task_id: taskId
  });
}

async function requestExport(taskId: string): Promise<{ taskId: string; exportJsonPath: string }> {
  return invoke<{ taskId: string; exportJsonPath: string }>("collector_export_task", {
    base_url: collectorBase.value,
    task_id: taskId
  });
}

function stopPolling() {
  if (pollTimer !== undefined) {
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

function startPolling(taskId: string) {
  stopPolling();
  pollTimer = window.setInterval(async () => {
    try {
      const task = await requestTask(taskId);
      currentTask.value = task;
      if (["completed", "partial", "failed", "cancelled"].includes(task.status)) {
        stopPolling();
      }
    } catch (error) {
      stopPolling();
      message.value = error instanceof Error ? error.message : "轮询失败";
    }
  }, 1200);
}

async function refreshSessionStatus() {
  loading.value = true;
  try {
    sessionStatus.value = await requestSessionStatus();
    message.value = "会话状态已刷新";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "会话状态获取失败";
  } finally {
    loading.value = false;
  }
}

async function openLoginWindow() {
  loading.value = true;
  try {
    sessionStatus.value = await requestOpenLogin();
    message.value = "已打开登录窗口，请在浏览器中完成登录";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "打开登录窗口失败";
  } finally {
    loading.value = false;
  }
}

async function startCollect() {
  loading.value = true;
  try {
    const created = await requestCreateTask(productUrl.value);
    message.value = `任务已创建：${created.taskId}`;
    startPolling(created.taskId);
    currentTask.value = await requestTask(created.taskId);
  } catch (error) {
    message.value = error instanceof Error ? error.message : "创建任务失败";
  } finally {
    loading.value = false;
  }
}

async function exportCurrentTask() {
  if (!currentTask.value) return;
  loading.value = true;
  try {
    const data = await requestExport(currentTask.value.id);
    message.value = `导出成功：${data.exportJsonPath}`;
    currentTask.value = await requestTask(data.taskId);
  } catch (error) {
    message.value = error instanceof Error ? error.message : "导出失败";
  } finally {
    loading.value = false;
  }
}

onUnmounted(() => {
  stopPolling();
});

onMounted(async () => {
  try {
    const bootstrap = await requestEnsureCollectorStarted();
    if (bootstrap.started) {
      collectorBase.value = bootstrap.base_url;
      message.value = "collector 已自动启动";
    }
  } catch (error) {
    message.value = error instanceof Error ? error.message : "collector 启动失败";
  }
});
</script>

<template>
  <main class="container">
    <h1>淘宝采集桌面端（前端骨架）</h1>

    <section class="panel">
      <label>Collector 地址</label>
      <input v-model="collectorBase" placeholder="http://127.0.0.1:4318" />

      <label>商品链接</label>
      <input v-model="productUrl" placeholder="请输入商品链接" />

      <div class="actions">
        <button :disabled="loading" @click="refreshSessionStatus">检查会话</button>
        <button :disabled="loading" @click="openLoginWindow">打开登录窗口</button>
        <button :disabled="loading || !productUrl" @click="startCollect">开始采集</button>
        <button :disabled="loading || !canExport" @click="exportCurrentTask">导出 JSON</button>
      </div>
    </section>

    <section class="panel">
      <h2>会话状态</h2>
      <pre>{{ sessionStatus ?? "尚未获取" }}</pre>
    </section>

    <section class="panel">
      <h2>任务状态</h2>
      <pre>{{ currentTask ?? "尚未创建任务" }}</pre>
    </section>

    <p class="message">{{ message }}</p>
  </main>
</template>
