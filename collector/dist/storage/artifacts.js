import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const runtimeRoot = path.join(process.cwd(), ".runtime");
function taskDir(taskId) {
    return path.join(runtimeRoot, "tasks", taskId);
}
function debugDir(taskId) {
    return path.join(taskDir(taskId), "debug");
}
function exportDir(taskId) {
    return path.join(runtimeRoot, "exports", `task-${taskId}`);
}
export async function ensureTaskDebugDir(taskId) {
    const dir = debugDir(taskId);
    await mkdir(dir, { recursive: true });
    return dir;
}
export async function saveTaskPageHtml(taskId, html) {
    const dir = await ensureTaskDebugDir(taskId);
    const filePath = path.join(dir, "page.html");
    await writeFile(filePath, html, "utf-8");
    return filePath;
}
export async function saveTaskResultJson(taskId, payload) {
    const dir = await ensureTaskDebugDir(taskId);
    const filePath = path.join(dir, "result.json");
    await writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
    return filePath;
}
export async function exportTaskToJson(task) {
    const dir = exportDir(task.id);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "product.json");
    await writeFile(filePath, JSON.stringify(task, null, 2), "utf-8");
    return filePath;
}
