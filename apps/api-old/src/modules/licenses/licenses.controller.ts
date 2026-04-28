import { Body, Controller, Get, Headers, Inject, Post } from "@nestjs/common"
import type { RedeemLicenseRequest } from "@tb-pdd-image/shared"

import { DatabaseStore } from "../../common/store/database.store.js"

@Controller("/v1/licenses")
export class LicensesController {
  constructor(@Inject(DatabaseStore) private readonly store: DatabaseStore) {}

  @Post("redeem")
  redeem(@Body() body: RedeemLicenseRequest) {
    return this.store.redeemLicense(body.activationCode)
  }

  @Get("current")
  current(@Headers("authorization") authorization?: string) {
    return this.store.getCurrentLicense(authorization)
  }
}
