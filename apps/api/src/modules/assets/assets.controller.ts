import { Body, Controller, Headers, Param, Post } from "@nestjs/common"
import type { ConvertAssetRequest } from "@tb-pdd-image/shared"

import { DatabaseStore } from "../../common/store/database.store.js"

@Controller("/v1/assets")
export class AssetsController {
  constructor(private readonly store: DatabaseStore) {}

  @Post(":assetId/convert")
  convert(
    @Param("assetId") assetId: string,
    @Body() body: ConvertAssetRequest,
    @Headers("authorization") authorization?: string
  ) {
    return this.store.convertAsset(assetId, body, authorization)
  }
}
