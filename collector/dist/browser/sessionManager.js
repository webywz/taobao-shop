import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
class SessionManager {
    context;
    profileDir;
    loginUrl = "https://login.taobao.com/";
    constructor() {
        this.profileDir =
            process.env.COLLECTOR_PROFILE_DIR ??
                path.join(process.cwd(), ".runtime", "profiles", "default");
    }
    async createContext() {
        await mkdir(this.profileDir, { recursive: true });
        return chromium.launchPersistentContext(this.profileDir, {
            headless: false,
            viewport: { width: 1366, height: 900 }
        });
    }
    async startSession() {
        if (!this.context) {
            this.context = await this.createContext();
        }
    }
    async openLoginWindow() {
        await this.startSession();
        const page = await this.getPrimaryPage();
        await page.goto(this.loginUrl, { waitUntil: "domcontentloaded" });
    }
    async getPrimaryPage() {
        await this.startSession();
        const pages = this.context.pages();
        if (pages.length > 0) {
            return pages[0];
        }
        return this.context.newPage();
    }
    async newPage() {
        await this.startSession();
        return this.context.newPage();
    }
    async checkLoggedIn() {
        await this.startSession();
        const cookies = await this.context.cookies();
        const cookieNames = new Set(cookies.map((cookie) => cookie.name));
        return ["_nk_", "lgc", "tracknick"].some((name) => cookieNames.has(name));
    }
    async getStatus() {
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
