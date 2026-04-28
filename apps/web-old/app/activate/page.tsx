import { ActivateForm } from "./activate-form"

export default function ActivatePage() {
  return (
    <>
      <section className="hero">
        <div className="hero-tagline">🔑 Step 01</div>
        <h1>激活当前浏览器</h1>
        <p className="hero-copy">激活后会生成当前设备可用的 <code>license_token</code>，用于后续的插件绑定与任务执行。</p>
      </section>
      <div className="grid two">
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-tagline">License</div>
              <h2>输入卡密并继续</h2>
              <p>激活成功后继续安装插件。</p>
            </div>
          </div>
          <ActivateForm />
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-tagline">📋 Notes</div>
              <h2>简要说明</h2>
            </div>
          </div>
          <ul className="list">
            <li>
              <strong>🔒 设备绑定</strong>
              一个 license 当前只绑定一个浏览器设备。
            </li>
            <li>
              <strong>⚙️ 执行前提</strong>
              没有插件绑定时，任务可以创建，但不会被插件领取。
            </li>
            <li>
              <strong>📌 建议流程</strong>
              激活后先安装插件，再创建任务。
            </li>
          </ul>
        </section>
      </div>
    </>
  )
}
