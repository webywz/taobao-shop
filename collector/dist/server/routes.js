import { Router } from "express";
import { z } from "zod";
import { sessionManager } from "../browser/sessionManager.js";
import { exportTaskToJson } from "../storage/artifacts.js";
import { runCollectProductWorkflow } from "./collectProductWorkflow.js";
import { cancelTask, createTask, getTaskById, updateTask } from "./taskStore.js";
const createTaskSchema = z.object({
    url: z.url()
});
export const apiRouter = Router();
apiRouter.get("/health", (_req, res) => {
    res.json({ ok: true });
});
apiRouter.post("/session/start", async (_req, res) => {
    await sessionManager.startSession();
    const status = await sessionManager.getStatus();
    res.json(status);
});
apiRouter.post("/session/login/open", async (_req, res) => {
    await sessionManager.openLoginWindow();
    const status = await sessionManager.getStatus();
    res.json(status);
});
apiRouter.get("/session/status", async (_req, res) => {
    const status = await sessionManager.getStatus();
    res.json(status);
});
apiRouter.post("/collect/product", (req, res) => {
    const parsed = createTaskSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            error: "INVALID_REQUEST",
            message: "url is required and must be a valid URL"
        });
    }
    const task = createTask({ url: parsed.data.url });
    void runCollectProductWorkflow(task.id, parsed.data.url);
    return res.status(202).json({
        taskId: task.id,
        status: task.status
    });
});
apiRouter.get("/tasks/:id", (req, res) => {
    const task = getTaskById(req.params.id);
    if (!task) {
        return res.status(404).json({
            error: "TASK_NOT_FOUND",
            message: "task does not exist"
        });
    }
    return res.json(task);
});
apiRouter.post("/tasks/:id/cancel", (req, res) => {
    const task = cancelTask(req.params.id);
    if (!task) {
        return res.status(404).json({
            error: "TASK_NOT_FOUND",
            message: "task does not exist"
        });
    }
    return res.json(task);
});
apiRouter.post("/export/:id", async (req, res) => {
    const task = getTaskById(req.params.id);
    if (!task) {
        return res.status(404).json({
            error: "TASK_NOT_FOUND",
            message: "task does not exist"
        });
    }
    if (!task.result) {
        return res.status(409).json({
            error: "TASK_RESULT_NOT_READY",
            message: "task has no result to export"
        });
    }
    const exportJsonPath = await exportTaskToJson(task);
    updateTask(task.id, {
        artifacts: {
            ...task.artifacts,
            exportJsonPath
        }
    });
    return res.json({
        taskId: task.id,
        exportJsonPath
    });
});
