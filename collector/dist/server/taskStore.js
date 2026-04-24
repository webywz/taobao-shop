import { randomUUID } from "node:crypto";
const tasks = new Map();
function now() {
    return new Date().toISOString();
}
export function updateTask(id, patch) {
    const existing = tasks.get(id);
    if (!existing)
        return;
    tasks.set(id, {
        ...existing,
        ...patch,
        updatedAt: now()
    });
}
export function createTask(input) {
    const id = randomUUID();
    const record = {
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
export function getTaskById(id) {
    return tasks.get(id);
}
export function cancelTask(id) {
    const task = tasks.get(id);
    if (!task)
        return undefined;
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
export function isTaskCancelled(id) {
    return tasks.get(id)?.status === "cancelled";
}
export function markTaskStage(id, status, progress) {
    const finishedAt = status === "completed" || status === "failed" || status === "cancelled" ? now() : undefined;
    updateTask(id, { status, progress, finishedAt });
}
export function markTaskFailed(id, message) {
    updateTask(id, {
        status: "failed",
        progress: 100,
        errorMessage: message,
        finishedAt: now()
    });
}
