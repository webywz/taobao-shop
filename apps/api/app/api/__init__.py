from fastapi import APIRouter
from . import tasks, assets, devices, licenses, uploads, admin

router = APIRouter()
router.include_router(tasks.router)
router.include_router(assets.router)
router.include_router(devices.router)
router.include_router(licenses.router)
router.include_router(uploads.router)
router.include_router(admin.router)
