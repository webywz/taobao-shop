import { Body, Controller, Headers, Inject, Param, Post } from "@nestjs/common"
import type {
  BindLicenseRequest,
  HeartbeatRequest,
  RegisterDeviceRequest
} from "@tb-pdd-image/shared"

import { DatabaseStore } from "../../common/store/database.store.js"

@Controller("/v1/devices")
export class DevicesController {
  constructor(@Inject(DatabaseStore) private readonly store: DatabaseStore) {}

  @Post("register")
  register(@Body() body: RegisterDeviceRequest) {
    return this.store.registerDevice(body)
  }

  @Post(":deviceId/bind-license")
  bindLicense(@Param("deviceId") deviceId: string, @Body() body: BindLicenseRequest) {
    return this.store.bindLicense(deviceId, body)
  }

  @Post(":deviceId/heartbeat")
  heartbeat(
    @Param("deviceId") deviceId: string,
    @Body() body: HeartbeatRequest,
    @Headers("authorization") authorization?: string
  ) {
    return this.store.heartbeat(deviceId, body, authorization)
  }
}
