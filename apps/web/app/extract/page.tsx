import { TaskCreatePanel } from "./task-create-panel"

export default function ExtractPage() {
  return (
    <>
      <section className="hero">
        <div className="hero-tagline">📦 Step 03</div>
        <h1>输入链接，创建提取任务</h1>
        <p className="hero-copy">任务创建后会立即通知插件执行，支持淘宝、天猫、拼多多。</p>
      </section>
      <div className="grid two">
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-tagline">🚀 Queue</div>
              <h2>创建采集任务</h2>
              <p>复制商品链接后直接提交。</p>
            </div>
          </div>
          <TaskCreatePanel />
          <ul className="list" style={{ marginTop: 16 }}>
            <li>
              <strong>🌐 支持平台</strong>
              淘宝 / 天猫 / 拼多多。
            </li>
            <li>
              <strong>⚡ 触发方式</strong>
              创建后立即通知插件。
            </li>
          </ul>
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-tagline">🔍 Debug</div>
              <h2>快速排查</h2>
            </div>
          </div>
          <ul className="list">
            <li>
              <strong>😐 没反应</strong>
              先检查插件状态。
            </li>
            <li>
              <strong>⏸️ 任务不执行</strong>
              先确认插件已绑定当前 License。
            </li>
            <li>
              <strong>❌ 结果不对</strong>
              去任务详情页看分类结果。
            </li>
          </ul>
        </section>
      </div>
    </>
  )
}
