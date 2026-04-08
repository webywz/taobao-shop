import type { ReactNode } from "react"
import type { Metadata } from "next"
import Link from "next/link"

import "./globals.css"

export const metadata: Metadata = {
  title: "ImageFlow — 商品图片提取台",
  description: "一站式淘宝 / 天猫 / 拼多多商品图片提取、归档与格式转换平台",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <header className="shell-header">
          <div className="shell-header-row">
            <div className="brand">
              <div className="brand-icon">⚡</div>
              <span className="brand-title">ImageFlow</span>
            </div>
            <nav className="nav">
              <Link href="/"><span className="nav-icon">🏠</span> 首页</Link>
              <Link href="/activate"><span className="nav-icon">🔑</span> 激活</Link>
              <Link href="/install-plugin"><span className="nav-icon">🧩</span> 插件</Link>
              <Link href="/extract"><span className="nav-icon">📦</span> 提取</Link>
              <Link href="/tasks"><span className="nav-icon">📋</span> 历史</Link>
              <Link href="/help"><span className="nav-icon">💡</span> 帮助</Link>
            </nav>
          </div>
        </header>
        <main className="app-shell">
          {children}
        </main>
      </body>
    </html>
  )
}
