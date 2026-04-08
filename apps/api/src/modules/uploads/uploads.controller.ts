import { Body, Controller, Headers, Inject, Post } from "@nestjs/common"
import type { CompleteUploadRequest, PresignUploadRequest } from "@tb-pdd-image/shared"

import { DatabaseStore } from "../../common/store/database.store.js"

@Controller("/v1/uploads")
export class UploadsController {
  constructor(@Inject(DatabaseStore) private readonly store: DatabaseStore) {}

  @Post("presign")
  presign(@Body() body: PresignUploadRequest, @Headers("authorization") authorization?: string) {
    return this.store.presignUploads(body, authorization)
  }

  @Post("complete")
  complete(@Body() body: CompleteUploadRequest, @Headers("authorization") authorization?: string) {
    return this.store.completeUploads(body, authorization)
  }
}
