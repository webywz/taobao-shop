import cors from "cors";
import express from "express";
import { apiRouter } from "./server/routes.js";
const app = express();
const port = Number(process.env.COLLECTOR_PORT ?? 4318);
app.use(cors());
app.use(express.json());
app.use(apiRouter);
app.listen(port, "127.0.0.1", () => {
    console.log(`[collector] listening on http://127.0.0.1:${port}`);
});
