#!/usr/bin/env python3
"""
Pinduoduo scraper via Playwright browser runtime.

It uses real browser execution to avoid plain-HTTP anti-bot failures (429 / need anti_content).

Usage:
  export PDD_COOKIE='k1=v1; k2=v2; ...'
  export PDD_VERIFY_AUTH_TOKEN='xxxx'  # optional
  python3 scripts/pdd_scrape_playwright.py \
    --url "https://mobile.yangkeduo.com/goods1.html?ps=xxxx"
"""

from __future__ import annotations

import argparse
import json
import os
import time
from typing import Any

from playwright.sync_api import sync_playwright


IPHONE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 "
    "Mobile/15E148 Safari/604.1"
)


def parse_cookie_header(cookie_header: str) -> list[dict[str, Any]]:
    cookies = []
    for part in cookie_header.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        name, value = part.split("=", 1)
        name = name.strip()
        value = value.strip()
        if not name:
            continue
        cookies.append(
            {
                "name": name,
                "value": value,
                "domain": ".yangkeduo.com",
                "path": "/",
                "httpOnly": False,
                "secure": True,
            }
        )
    return cookies


def js_extract() -> str:
    return r"""
() => {
  function normalizeUrl(raw) {
    try {
      const u = new URL(raw, location.href);
      u.hash = "";
      return u.toString();
    } catch {
      return null;
    }
  }

  function isImageLike(url) {
    if (!url) return false;
    if (!/^https?:\/\//i.test(url)) return false;
    try {
      const parsed = new URL(url);
      if (/\.html?$/i.test(parsed.pathname)) return false;
    } catch {}
    if (/\.(jpg|jpeg|png|webp|gif|bmp|avif)(\?|$)/i.test(url)) return true;
    return /(pddpic\.com|yangkeduo\.com|pinduoduo\.com)/i.test(url) && /(img|image|pic|photo)/i.test(url);
  }

  const images = new Set();

  for (const img of Array.from(document.images)) {
    const src = img.currentSrc || img.src || img.getAttribute("data-src") || img.getAttribute("data-lazy-src");
    const n = normalizeUrl(src || "");
    if (n && isImageLike(n)) images.add(n);
  }

  function walk(value, depth, seen) {
    if (!value || depth > 14) return;
    if (typeof value === "string") {
      const n = normalizeUrl(value);
      if (n && isImageLike(n)) images.add(n);
      return;
    }
    if (typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1, seen);
      return;
    }
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === "string") {
        const n = normalizeUrl(v);
        if (n && isImageLike(n)) images.add(n);
      } else {
        walk(v, depth + 1, seen);
      }
    }
  }

  const seen = new WeakSet();
  const candidates = [
    window.rawData,
    window.__RAW_DATA__,
    window.__INITIAL_STATE__,
    window.__PRELOADED_STATE__,
    window.__NEXT_DATA__
  ];
  for (const c of candidates) walk(c, 0, seen);

  const pageText = (document.body?.innerText || "").replace(/\s+/g, " ");
  const needLogin = /请登录|立即登录|手机号登录|微信登录|短信登录|滑块验证/.test(document.title + " " + pageText);
  const goodsId = new URL(location.href).searchParams.get("goods_id") || null;

  return {
    final_url: location.href,
    title: document.title || null,
    goods_id: goodsId,
    need_login: needLogin,
    image_count: images.size,
    images: Array.from(images).slice(0, 300)
  };
}
"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True, help="Pinduoduo product/share URL")
    parser.add_argument(
        "--cookie",
        default=os.getenv("PDD_COOKIE", ""),
        help="Raw Cookie header string (default from env PDD_COOKIE)",
    )
    parser.add_argument(
        "--verifyauthtoken",
        default=os.getenv("PDD_VERIFY_AUTH_TOKEN", ""),
        help="verifyauthtoken header (default from env PDD_VERIFY_AUTH_TOKEN)",
    )
    parser.add_argument("--wait-seconds", type=int, default=14, help="Post-load wait seconds")
    args = parser.parse_args()

    result: dict[str, Any] = {"ok": False}

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--disable-blink-features=AutomationControlled"],
        )
        device = p.devices.get("iPhone 13")
        if device:
            context = browser.new_context(
                **device,
                locale="zh-CN",
            )
        else:
            context = browser.new_context(
                user_agent=IPHONE_UA,
                viewport={"width": 390, "height": 844},
                is_mobile=True,
                has_touch=True,
                device_scale_factor=3,
                locale="zh-CN",
            )
        context.add_init_script(
            """
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
"""
        )

        extra_headers = {
            "accept-language": "zh-CN,zh;q=0.9",
            "origin": "https://mobile.yangkeduo.com",
            "referer": "https://mobile.yangkeduo.com/",
        }
        if args.verifyauthtoken:
            extra_headers["verifyauthtoken"] = args.verifyauthtoken
        context.set_extra_http_headers(extra_headers)

        if args.cookie:
            cookies = parse_cookie_header(args.cookie)
            if cookies:
                context.add_cookies(cookies)

        page = context.new_page()

        api_hits: list[str] = []
        api_all_hits: list[str] = []

        def on_response(resp):
            url = resp.url
            if "mobile.yangkeduo.com/proxy/api" in url:
                if len(api_all_hits) < 120:
                    api_all_hits.append(url)
                if "goods" in url and len(api_hits) < 50:
                    api_hits.append(url)

        page.on("response", on_response)

        page.goto(args.url, wait_until="domcontentloaded", timeout=45000)
        page.wait_for_timeout(3500)

        # Trigger lazy content.
        for _ in range(7):
            page.mouse.wheel(0, 1300)
            page.wait_for_timeout(800)
        page.mouse.wheel(0, -99999)
        page.wait_for_timeout(max(args.wait_seconds, 1) * 1000)

        extracted = page.evaluate(js_extract())

        result = {
            "ok": True,
            "input_url": args.url,
            "final_url": extracted.get("final_url"),
            "title": extracted.get("title"),
            "goods_id": extracted.get("goods_id"),
            "need_login": extracted.get("need_login"),
            "image_count": extracted.get("image_count"),
            "sample_images": (extracted.get("images") or [])[:30],
            "goods_api_hits": api_hits,
            "api_hits_total": len(api_all_hits),
            "api_hits_sample": api_all_hits[:40],
            "captured_at": int(time.time()),
        }

        browser.close()

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
