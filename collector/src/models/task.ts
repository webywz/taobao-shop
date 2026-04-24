export type TaskStatus =
  | "created"
  | "queued"
  | "launching_browser"
  | "waiting_login"
  | "loading_page"
  | "extracting"
  | "normalizing"
  | "persisting"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

export type TaskRecord = {
  id: string;
  sourceUrl: string;
  finalUrl?: string;
  status: TaskStatus;
  progress: number;
  result?: {
    title?: string;
    priceText?: string;
    shopName?: string;
    finalUrl?: string;
  };
  artifacts?: {
    debugDir?: string;
    screenshotPath?: string;
    pageHtmlPath?: string;
    resultJsonPath?: string;
    exportJsonPath?: string;
  };
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  errorMessage?: string;
};

export type CreateTaskInput = {
  url: string;
};
