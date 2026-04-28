import { InstallPluginPanel } from "../components/install-plugin-panel"

export default function InstallPluginPage() {
  return (
    <>
      <section className="hero">
        <div className="hero-tagline">🧩 Step 02</div>
        <h1>安装插件并完成检测</h1>
        <p className="hero-copy">下载 ZIP，加载到 Chrome 扩展管理页，然后回到这里检测并绑定。</p>
      </section>
      <InstallPluginPanel />
    </>
  )
}
