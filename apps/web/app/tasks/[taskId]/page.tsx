import { TaskDetailClient } from "./task-detail-client"

type TaskDetailPageProps = {
  params: Promise<{
    taskId: string
  }>
}

export default async function TaskDetailPage({ params }: TaskDetailPageProps) {
  const { taskId } = await params

  return (
    <>
      <section className="hero">
        <div className="hero-grid">
          <div>
            <div className="hero-tagline">🔎 Task Detail</div>
            <h1>{taskId}</h1>
            <p className="hero-copy">
              状态、图片分类、归档和转换动作都收敛在这一页。
            </p>
          </div>
          <div className="hero-metrics">
            <div className="metric-card">
              <span>🎯 Purpose</span>
              <strong>先看状态，再看图片</strong>
              <p>任务是否完成、是否失败、是否上传成功。</p>
            </div>
            <div className="metric-card">
              <span>🖼️ Preview</span>
              <strong>分组渲染 + 放大查看</strong>
              <p>图片默认完整展示，点击后进入大图预览。</p>
            </div>
          </div>
        </div>
      </section>
      <TaskDetailClient taskId={taskId} />
    </>
  )
}
