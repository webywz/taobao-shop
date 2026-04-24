import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TaskRecord } from "../models/task.js";

const runtimeRoot = path.join(process.cwd(), ".runtime");

function taskDir(taskId: string): string {
  return path.join(runtimeRoot, "tasks", taskId);
}

function debugDir(taskId: string): string {
  return path.join(taskDir(taskId), "debug");
}

function exportDir(taskId: string): string {
  return path.join(runtimeRoot, "exports", `task-${taskId}`);
}

export async function ensureTaskDebugDir(taskId: string): Promise<string> {
  const dir = debugDir(taskId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function saveTaskPageHtml(taskId: string, html: string): Promise<string> {
  const dir = await ensureTaskDebugDir(taskId);
  const filePath = path.join(dir, "page.html");
  await writeFile(filePath, html, "utf-8");
  return filePath;
}

export async function saveTaskResultJson(
  taskId: string,
  payload: Record<string, unknown>
): Promise<string> {
  const dir = await ensureTaskDebugDir(taskId);
  const filePath = path.join(dir, "result.json");
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
  return filePath;
}

export async function exportTaskToJson(task: TaskRecord): Promise<string> {
  const dir = exportDir(task.id);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "product.json");
  await writeFile(filePath, JSON.stringify(task, null, 2), "utf-8");
  return filePath;
}
