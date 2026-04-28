"use client"

import Link from "next/link"
import { useState } from "react"

type HomeStep = {
  id: string
  icon: string
  shortTitle: string
  title: string
  copy: string
  detail: string
  status: string
  href: string
  action: string
}

const steps: HomeStep[] = [
  {
    id: "01",
    icon: "🔑",
    shortTitle: "激活当前浏览器",
    title: "激活当前浏览器",
    copy: "输入卡密，生成当前浏览器可用的授权状态。",
    detail: "激活后会生成当前设备可用的 license_token，后续插件绑定和任务执行都基于这个状态。",
    status: "先完成授权绑定",
    href: "/activate",
    action: "去激活 →",
  },
  {
    id: "02",
    icon: "🧩",
    shortTitle: "安装插件并检测",
    title: "安装插件并完成检测",
    copy: "下载 ZIP，加载目录，然后回到页面检测并绑定。",
    detail: "插件安装成功后，浏览器才具备接收任务和执行图片提取的能力。",
    status: "确认插件在线",
    href: "/install-plugin",
    action: "安装插件 →",
  },
  {
    id: "03",
    icon: "📦",
    shortTitle: "创建提取任务",
    title: "输入链接，创建任务",
    copy: "任务创建后会立即通知插件执行。",
    detail: "支持淘宝、天猫链接。创建成功后，插件会按当前授权状态接手执行。",
    status: "提交待提取链接",
    href: "/extract",
    action: "创建任务 →",
  },
  {
    id: "04",
    icon: "📋",
    shortTitle: "查看历史结果",
    title: "所有执行结果汇总于此",
    copy: "统一查看任务状态、结果数量、详情与归档内容。",
    detail: "历史页负责统一回看任务状态和图片结果，也是后续排查异常的主入口。",
    status: "统一回看输出",
    href: "/tasks",
    action: "查看历史 →",
  },
]

const notes = [
  { icon: "📌", text: "建议顺序是先激活，再安装插件，再创建任务。" },
  { icon: "🔍", text: "如果插件没有响应，先回帮助页检查安装和绑定状态。" },
  { icon: "⚡", text: "日常使用通常只需要进入提取页和历史页。" },
]

export function HomeStepShowcase() {
  const [activeStepId, setActiveStepId] = useState(steps[0].id)
  const activeStep = steps.find((step) => step.id === activeStepId) ?? steps[0]

  return (
    <section className="home-page">
      <section className="hero home-showcase">
        <div className="home-showcase-head">
          <div className="hero-tagline">⚡ 商品图片提取台</div>
          <h1>{activeStep.title}</h1>
          <p className="hero-copy">{activeStep.copy}</p>
          <p className="home-showcase-detail">{activeStep.detail}</p>
          <div className="home-showcase-actions">
            <Link href={activeStep.href} className="button">
              {activeStep.action}
            </Link>
            <span className="home-showcase-status">{activeStep.status}</span>
          </div>
        </div>

        <div className="home-step-switcher" role="tablist" aria-label="操作步骤切换">
          {steps.map((step) => {
            const isActive = step.id === activeStep.id

            return (
              <button
                key={step.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`home-step-trigger${isActive ? " is-active" : ""}`}
                onClick={() => setActiveStepId(step.id)}
              >
                <span>{`${step.icon}  Step ${step.id}`}</span>
                <strong>{step.shortTitle}</strong>
                <p>{step.title}</p>
              </button>
            )
          })}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-tagline">💡 Tips</div>
            <h2>使用提醒</h2>
          </div>
        </div>
        <ul className="list">
          {notes.map((item) => (
            <li key={item.text}>{item.icon}  {item.text}</li>
          ))}
        </ul>
      </section>
    </section>
  )
}
