import "reflect-metadata"

import { join } from "node:path"
import { loadEnvFile } from "node:process"

function tryLoadEnv(relativePath: string) {
  try {
    loadEnvFile(join(process.cwd(), relativePath))
  } catch {
    // Ignore missing env files in local development.
  }
}

async function bootstrap() {
  tryLoadEnv(".env")
  tryLoadEnv("apps/api/.env")

  const { NestFactory } = await import("@nestjs/core")
  const { AppModule } = await import("./app.module.js")
  const app = await NestFactory.create(AppModule)

  app.enableCors()
  await app.listen(3001)
}

void bootstrap()
