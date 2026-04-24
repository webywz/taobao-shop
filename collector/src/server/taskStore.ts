import { randomUUID } from "node:crypto";
import type { CreateTaskInput, TaskRecord, TaskStatus } from "../models/task.js";

const tasks = new Map<string, TaskRecord>();

function now() {
  return new Date().toISOString();
}

export function updateTask(id: string, patch: Partial<TaskRecord>) {
  const existing = tasks.get(id);
  if (!existing) return;

  tasks.set(id, {
    ...existing,
    ...patch,
    updatedAt: now()
  });
}

export function createTask(input: CreateTaskInput): TaskRecord {
  const id = randomUUID();
  const record: TaskRecord = {
    id,
    sourceUrl: input.url,
    status: "created",
    progress: 0,
    createdAt: now(),
    updatedAt: now(),
    startedAt: now()
  };

  tasks.set(id, record);
  return record;
}

export function getTaskById(id: string): TaskRecord | undefined {
  return tasks.get(id);
}

export function cancelTask(id: string): TaskRecord | undefined {
  const task = tasks.get(id);
  if (!task) return undefined;
  if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
    return task;
  }

  updateTask(id, {
    status: "cancelled",
    progress: task.progress,
    finishedAt: now()
  });

  return tasks.get(id);
}

export function isTaskCancelled(id: string): boolean {
  return tasks.get(id)?.status === "cancelled";
}

export function markTaskStage(id: string, status: TaskStatus, progress: number): void {
  const finishedAt =
    status === "completed" || status === "failed" || status === "cancelled" ? now() : undefined;
  updateTask(id, { status, progress, finishedAt });
}

export function markTaskFailed(id: string, message: string): void {
  updateTask(id, {
    status: "failed",
    progress: 100,
    errorMessage: message,
    finishedAt: now()
  });
}
