import { TaskListClient } from "./task-list-client"

export default function TasksPage() {
  return (
    <>
      <section className="hero">
        <div className="hero-grid">
          <div>
            <div className="hero-tagline">📋 Task Archive</div>
            <h1>所有执行结果汇总于此</h1>
            <p className="hero-copy">
              统一查看任务状态、进入详情、回看图片分类结果，以及后续的归档和格式转换动作。
            </p>
          </div>
          <div className="hero-metrics">
            <div className="metric-card">
              <span>🎯 Result View</span>
              <strong>统一回放</strong>
              <p>所有结果用同一套详情页展示。</p>
            </div>
            <div className="metric-card">
              <span>🔬 Diagnosis</span>
              <strong>状态优先</strong>
              <p>先看状态，再看数量和分类。</p>
            </div>
          </div>
        </div>
      </section>
      <TaskListClient />
    </>
  )
}
