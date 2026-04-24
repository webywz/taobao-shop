import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";

export type SessionStatus = {
  started: boolean;
  loggedIn: boolean;
  profileDir: string;
  lastCheckedAt?: string;
};

class SessionManager {
  private context?: BrowserContext;
  private readonly profileDir: string;
  private readonly loginUrl = "https://login.taobao.com/";

  constructor() {
    this.profileDir =
      process.env.COLLECTOR_PROFILE_DIR ??
      path.join(process.cwd(), ".runtime", "profiles", "default");
  }

  private async createContext(): Promise<BrowserContext> {
    await mkdir(this.profileDir, { recursive: true });
    return chromium.launchPersistentContext(this.profileDir, {
      headless: false,
      viewport: { width: 1366, height: 900 }
    });
  }

  async startSession(): Promise<void> {
    if (!this.context) {
      this.context = await this.createContext();
    }
  }

  async openLoginWindow(): Promise<void> {
    await this.startSession();
    const page = await this.getPrimaryPage();
    await page.goto(this.loginUrl, { waitUntil: "domcontentloaded" });
  }

  async getPrimaryPage(): Promise<Page> {
    await this.startSession();
    const pages = this.context!.pages();
    if (pages.length > 0) {
      return pages[0];
    }
    return this.context!.newPage();
  }

  async newPage(): Promise<Page> {
    await this.startSession();
    return this.context!.newPage();
  }

  async checkLoggedIn(): Promise<boolean> {
    await this.startSession();
    const cookies = await this.context!.cookies();
    const cookieNames = new Set(cookies.map((cookie) => cookie.name));
    return ["_nk_", "lgc", "tracknick"].some((name) => cookieNames.has(name));
  }

  async getStatus(): Promise<SessionStatus> {
    const started = Boolean(this.context);
    const loggedIn = started ? await this.checkLoggedIn() : false;
    return {
      started,
      loggedIn,
      profileDir: this.profileDir,
      lastCheckedAt: new Date().toISOString()
    };
  }
}

export const sessionManager = new SessionManager();
