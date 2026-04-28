import { Body, Controller, Get, Headers, Inject, Param, Post, Res } from "@nestjs/common"
import type {
  ClaimTaskRequest,
  ConvertTaskRequest,
  CreateTaskRequest,
  RetentionDays,
  TaskProgressRequest,
  SubmitTaskFailRequest,
  SubmitTaskResultRequest
} from "@tb-pdd-image/shared"

import { DatabaseStore } from "../../common/store/database.store.js"

@Controller("/v1/extract/tasks")
export class TasksController {
  constructor(@Inject(DatabaseStore) private readonly store: DatabaseStore) {}

  @Post()
  create(@Body() body: CreateTaskRequest, @Headers("authorization") authorization?: string) {
    return this.store.createTask(body, authorization)
  }

  @Get()
  async list(@Headers("authorization") authorization?: string) {
    const items = await this.store.listTasks(authorization)
    return {
      items,
      page: 1,
      pageSize: items.length,
      total: items.length
    }
  }

  @Get("queue/next")
  async next(
    @Res() response: { status: (code: number) => { send: () => void }; json: (body: unknown) => unknown },
    @Headers("authorization") authorization?: string
  ) {
    const nextTask = await this.store.nextTask(authorization)

    if (!nextTask) {
      return response.status(204).send()
    }

    return response.json(nextTask)
  }

  @Get(":taskId")
  getOne(@Param("taskId") taskId: string, @Headers("authorization") authorization?: string) {
    return this.store.getTask(taskId, authorization)
  }

  @Post(":taskId/claim")
  claim(
    @Param("taskId") taskId: string,
    @Body() body: ClaimTaskRequest,
    @Headers("authorization") authorization?: string
  ) {
    return this.store.claimTask(taskId, body, authorization)
  }

  @Post(":taskId/result")
  result(
    @Param("taskId") taskId: string,
    @Body() body: SubmitTaskResultRequest,
    @Headers("authorization") authorization?: string
  ) {
    return this.store.submitResult(taskId, body, authorization)
  }

  @Post(":taskId/progress")
  progress(
    @Param("taskId") taskId: string,
    @Body() body: TaskProgressRequest,
    @Headers("authorization") authorization?: string
  ) {
    return this.store.updateTaskProgress(taskId, body, authorization)
  }

  @Post(":taskId/fail")
  submitTaskFail(
    @Param("taskId") taskId: string,
    @Body() body: SubmitTaskFailRequest,
    @Headers("authorization") authorization?: string
  ) {
    return this.store.submitFail(taskId, body, authorization)
  }

  @Post(":taskId/archive")
  requestArchive(
    @Param("taskId") taskId: string,
    @Body() body: { retentionDays?: RetentionDays },
    @Headers("authorization") authorization?: string
  ) {
    return this.store.requestArchive(taskId, body.retentionDays ?? 7, authorization)
  }

  @Get(":taskId/archive")
  getArchive(@Param("taskId") taskId: string, @Headers("authorization") authorization?: string) {
    return this.store.getArchive(taskId, authorization)
  }

  @Post(":taskId/convert")
  convertTask(
    @Param("taskId") taskId: string,
    @Body() body: ConvertTaskRequest,
    @Headers("authorization") authorization?: string
  ) {
    return this.store.convertTask(taskId, body, authorization)
  }
}
