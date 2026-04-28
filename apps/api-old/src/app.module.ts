import { Module } from "@nestjs/common"

import { OssStorageService } from "./common/storage/oss-storage.service.js"
import { DatabaseStore } from "./common/store/database.store.js"
import { AssetsController } from "./modules/assets/assets.controller.js"
import { DevicesController } from "./modules/devices/devices.controller.js"
import { LicensesController } from "./modules/licenses/licenses.controller.js"
import { TasksController } from "./modules/tasks/tasks.controller.js"
import { UploadsController } from "./modules/uploads/uploads.controller.js"

@Module({
  controllers: [
    LicensesController,
    DevicesController,
    TasksController,
    AssetsController,
    UploadsController
  ],
  providers: [OssStorageService, DatabaseStore]
})
export class AppModule {}
