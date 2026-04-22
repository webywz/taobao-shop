#!/usr/bin/env python3
"""
Lightweight Pinduoduo page probe/scraper.

Usage:
  python3 scripts/pdd_scrape.py "https://mobile.yangkeduo.com/goods1.html?ps=xxxx"
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any


MOBILE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 "
    "Mobile/15E148 Safari/604.1"
)


@dataclass
class ProbeResult:
    input_url: str
    final_url: str
    status_code: int
    goods_id: str | None
    need_login: bool | None
    image_urls: list[str]


def extract_json_object(script: str, variable_name: str) -> str | None:
    marker = script.find(variable_name)
    if marker < 0:
        return None

    eq = script.find("=", marker + len(variable_name))
    if eq < 0:
        return None

    i = eq + 1
    n = len(script)
    while i < n and script[i].isspace():
        i += 1
    if i >= n or script[i] != "{":
        return None

    depth = 0
    in_string = False
    quote = ""
    escaped = False
    start = i

    while i < n:
        ch = script[i]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == quote:
                in_string = False
            i += 1
            continue

        if ch in ("'", '"', "`"):
            in_string = True
            quote = ch
            i += 1
            continue

        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return script[start : i + 1]
        i += 1

    return None


def deep_find_need_login(data: Any) -> bool | None:
    stack = [data]
    seen = set()
    limit = 20000
    visited = 0

    while stack and visited < limit:
        node = stack.pop()
        visited += 1

        node_id = id(node)
        if node_id in seen:
            continue
        seen.add(node_id)

        if isinstance(node, dict):
            if "needLogin" in node and isinstance(node["needLogin"], bool):
                return node["needLogin"]
            stack.extend(node.values())
        elif isinstance(node, list):
            stack.extend(node)

    return None


def find_image_urls(text: str, max_count: int = 120) -> list[str]:
    urls = set()
    for match in re.finditer(r"https?://[^\"'\\\s<>]+", text):
        url = match.group(0)
        lower = url.lower()
        if any(ext in lower for ext in [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]):
            urls.add(url)
            continue
        if ("pddpic.com" in lower or "yangkeduo.com" in lower) and any(
            k in lower for k in ["img", "image", "goods", "photo", "pic"]
        ):
            urls.add(url)
    return sorted(urls)[:max_count]


def probe(url: str, timeout: int = 25) -> ProbeResult:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": MOBILE_UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Cache-Control": "no-cache",
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        final_url = resp.geturl()
        status_code = resp.getcode()
        body = resp.read().decode("utf-8", errors="ignore")

    parsed = urllib.parse.urlparse(final_url)
    query = urllib.parse.parse_qs(parsed.query)
    goods_id = query.get("goods_id", [None])[0] or query.get("goodsId", [None])[0]

    raw_data_text = extract_json_object(body, "window.rawData")
    need_login = None
    if raw_data_text:
        try:
            raw_data = json.loads(raw_data_text)
            need_login = deep_find_need_login(raw_data)
        except json.JSONDecodeError:
            need_login = None

    image_urls = find_image_urls(body)

    return ProbeResult(
        input_url=url,
        final_url=final_url,
        status_code=status_code,
        goods_id=goods_id,
        need_login=need_login,
        image_urls=image_urls,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("url", help="Pinduoduo product/share url")
    args = parser.parse_args()

    try:
        result = probe(args.url)
    except Exception as exc:  # pylint: disable=broad-except
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1

    print(
        json.dumps(
            {
                "ok": True,
                "input_url": result.input_url,
                "final_url": result.final_url,
                "status_code": result.status_code,
                "goods_id": result.goods_id,
                "need_login": result.need_login,
                "image_count": len(result.image_urls),
                "sample_images": result.image_urls[:20],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

