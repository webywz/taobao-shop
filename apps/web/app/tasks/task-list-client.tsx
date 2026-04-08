"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import type { Task } from "@tb-pdd-image/shared"

import { listTasks } from "../lib/api"

function formatStatus(status: Task["status"]) {
  switch (status) {
    case "pending":
      return "待执行"
    case "claimed":
      return "已领取"
    case "running":
      return "执行中"
    case "uploading":
      return "上传中"
    case "completed":
      return "已完成"
    case "failed":
      return "失败"
    case "expired":
      return "已过期"
    default:
      return status
  }
}

export function TaskListClient() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void listTasks()
      .then((payload) => {
        setTasks(payload.items)
        setError(null)
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "获取历史任务失败")
      })
  }, [])

  if (error) {
    return <section className="panel">{error}</section>
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <div className="panel-tagline">📜 History</div>
          <h2>历史任务</h2>
          <p>进入单个任务可查看详细分类结果、归档状态和后续转换动作。</p>
        </div>
      </div>
      <div className="task-list">
        {tasks.length ? (
          tasks.map((task) => (
            <Link key={task.taskId} href={`/tasks/${task.taskId}`} className="task-card">
              <div className="task-card-top">
                <strong>{task.title ?? task.taskId}</strong>
                <span className="status-pill" data-status={task.status}>
                  {formatStatus(task.status)}
                </span>
              </div>
              <div className="meta-row">
                <div className="meta-chip">平台 {task.platform}</div>
                <div className="meta-chip">主图 {task.counts.main}</div>
                <div className="meta-chip">详情图 {task.counts.detail}</div>
                <div className="meta-chip">其他图片 {task.counts.other}</div>
              </div>
              <div className="muted" style={{ fontSize: '0.8rem' }}>{task.taskId}</div>
            </Link>
          ))
        ) : (
          <div className="info-card">
            <span>📭 Empty</span>
            <strong>当前还没有历史任务</strong>
            <p>先去提取页创建一个商品链接任务，结果会自动回到这里。</p>
          </div>
        )}
      </div>
    </section>
  )
}
