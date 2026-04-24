import { sessionManager } from "../browser/sessionManager.js";
import path from "node:path";
import { saveTaskPageHtml, saveTaskResultJson } from "../storage/artifacts.js";
import {
  isTaskCancelled,
  markTaskFailed,
  markTaskStage,
  updateTask
} from "./taskStore.js";

type ExtractedProduct = {
  title?: string;
  priceText?: string;
  shopName?: string;
};

export async function runCollectProductWorkflow(taskId: string, sourceUrl: string): Promise<void> {
  let page;
  try {
    markTaskStage(taskId, "queued", 5);
    await sessionManager.startSession();
    if (isTaskCancelled(taskId)) return;

    markTaskStage(taskId, "launching_browser", 15);
    page = await sessionManager.newPage();
    if (isTaskCancelled(taskId)) return;

    markTaskStage(taskId, "loading_page", 45);
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(1_000);
    if (isTaskCancelled(taskId)) return;

    markTaskStage(taskId, "extracting", 70);
    const extracted = await page.evaluate<ExtractedProduct>(() => {
      const firstText = (selectors: string[]): string | undefined => {
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          const text = el?.textContent?.trim();
          if (text) return text;
        }
        return undefined;
      };
      const titleSelectors = [
        "h1",
        ".tb-main-title",
        "[data-title='title']",
        ".ItemHeader--mainTitle"
      ];
      const priceSelectors = [
        ".price--currentPriceText",
        ".tb-rmb-num",
        ".Price--priceText",
        ".price"
      ];
      const shopSelectors = [".shop-name", ".shopName--name", ".seller-shop-name", ".J_ShopInfo a"];
      return {
        title: firstText(titleSelectors),
        priceText: firstText(priceSelectors),
        shopName: firstText(shopSelectors)
      };
    });
    if (isTaskCancelled(taskId)) return;

    markTaskStage(taskId, "normalizing", 85);
    const html = await page.content();
    const result = {
      ...extracted,
      finalUrl: page.url()
    };

    markTaskStage(taskId, "persisting", 95);
    const pageHtmlPath = await saveTaskPageHtml(taskId, html);
    const resultJsonPath = await saveTaskResultJson(taskId, {
      taskId,
      sourceUrl,
      ...result
    });
    const debugDir = path.dirname(pageHtmlPath);
    const screenshotPath = path.join(debugDir, "screenshot.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    updateTask(taskId, {
      finalUrl: result.finalUrl,
      result,
      artifacts: {
        debugDir,
        pageHtmlPath,
        screenshotPath,
        resultJsonPath
      }
    });

    markTaskStage(taskId, "completed", 100);
  } catch (error) {
    const message = error instanceof Error ? error.message : "collect failed";
    if (page) {
      try {
        const html = await page.content();
        const pageHtmlPath = await saveTaskPageHtml(taskId, html);
        const debugDir = path.dirname(pageHtmlPath);
        const screenshotPath = path.join(debugDir, "screenshot.png");
        await page.screenshot({ path: screenshotPath, fullPage: true });
        updateTask(taskId, {
          artifacts: {
            debugDir,
            pageHtmlPath,
            screenshotPath
          }
        });
      } catch {
        // Ignore debug artifact errors and keep the root error.
      }
    }
    markTaskFailed(taskId, message);
  } finally {
    await page?.close();
  }
}
