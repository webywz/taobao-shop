export default function HelpPage() {
  return (
    <>
      <section className="hero">
        <div className="hero-tagline">💡 Quick Help</div>
        <h1>先按流程走，再做排查</h1>
        <p className="hero-copy">激活 → 安装插件 → 绑定 → 创建任务 → 查看结果。</p>
      </section>
      <div className="grid three">
        <section className="step-card">
          <span>🔑 01</span>
          <strong>先激活卡密</strong>
          <p>生成当前浏览器授权。</p>
        </section>
        <section className="step-card">
          <span>🧩 02</span>
          <strong>再安装插件</strong>
          <p>加载解压后的插件目录。</p>
        </section>
        <section className="step-card">
          <span>🔗 03</span>
          <strong>完成绑定后再提取</strong>
          <p>没有绑定时插件不会执行任务。</p>
        </section>
      </div>
    </>
  )
}
