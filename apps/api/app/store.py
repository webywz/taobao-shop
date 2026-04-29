import datetime
import secrets
from fastapi import HTTPException
from app.database import database, create_id, plus_days, detect_platform, hash_activation_code
from app.admin_auth import verify_admin_token
from app.storage import oss_storage

def _to_iso(dt):
    if dt is None:
        return None
    if isinstance(dt, str):
        dt = dt.replace(" ", "T")
        if not dt.endswith("Z") and "+" not in dt:
            dt += "+00:00"
        return dt
    return dt.isoformat()

class DatabaseStore:
    def __init__(self):
        self.db = database
        self.storage = oss_storage

    def _get_bearer_token(self, authorization: str | None) -> str:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="missing bearer token")
        return authorization[len("Bearer "):].strip()

    async def _get_or_create_admin_license(self):
        row = await self.db.fetch_one(
            "select id, token, duration_days, expires_at from licenses where id = :id",
            {"id": "lic_admin_default"}
        )
        if row:
            return {
                "licenseId": row["id"],
                "licenseToken": row["token"],
                "durationDays": row["duration_days"],
                "expiresAt": _to_iso(row["expires_at"])
            }

        license_id = "lic_admin_default"
        license_token = "ltok_admin_default"
        expires_at = plus_days(36500)
        await self.db.execute(
            """
            insert into licenses (id, token, duration_days, expires_at)
            values (:id, :token, :duration_days, :expires_at)
            """,
            {
                "id": license_id,
                "token": license_token,
                "duration_days": 36500,
                "expires_at": expires_at
            }
        )
        return {
            "licenseId": license_id,
            "licenseToken": license_token,
            "durationDays": 36500,
            "expiresAt": _to_iso(expires_at)
        }

    async def _resolve_management_license(self, authorization: str | None, admin_token: str | None):
        if admin_token:
            verify_admin_token(admin_token)
            return await self._get_or_create_admin_license()
        if authorization and authorization.startswith("Bearer "):
            return await self.get_license_by_token(self._get_bearer_token(authorization))
        raise HTTPException(status_code=401, detail="authentication required")

    def _normalize_activation_code(self, activation_code: str) -> str:
        normalized = (activation_code or "").strip().upper()
        if not normalized:
            raise HTTPException(status_code=400, detail="activation code is required")
        return normalized

    def _generate_activation_code(self) -> str:
        # Keep characters readable and avoid confusing 0/O and 1/I
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        blocks = []
        for _ in range(4):
            blocks.append("".join(secrets.choice(alphabet) for _ in range(4)))
        return "-".join(blocks)

    def _is_expired(self, expires_at):
        if not expires_at:
            return False
        if isinstance(expires_at, datetime.datetime):
            compared = expires_at
        else:
            compared = datetime.datetime.fromisoformat(str(expires_at).replace(" ", "T"))
        if compared.tzinfo is None:
            compared = compared.replace(tzinfo=datetime.timezone.utc)
        return compared <= datetime.datetime.now(datetime.timezone.utc)

    async def generate_activation_codes(self, count: int, duration_days: int = 30, batch_no: str | None = None):
        if count < 1 or count > 1000:
            raise HTTPException(status_code=400, detail="count must be between 1 and 1000")
        if duration_days < 1 or duration_days > 3650:
            raise HTTPException(status_code=400, detail="duration_days must be between 1 and 3650")

        normalized_batch = (batch_no or "").strip() or f"batch_{datetime.datetime.now().strftime('%Y%m%d%H%M%S')}"
        generated_items = []
        used_hashes = set()
        attempts = 0
        max_attempts = count * 20

        async with self.db.transaction():
            while len(generated_items) < count:
                attempts += 1
                if attempts > max_attempts:
                    raise HTTPException(status_code=500, detail="failed to generate unique activation codes")

                code = self._generate_activation_code()
                code_hash = hash_activation_code(code)
                if code_hash in used_hashes:
                    continue

                existing = await self.db.fetch_one(
                    "select code_hash from activation_codes where code_hash = :code_hash",
                    {"code_hash": code_hash}
                )
                if existing:
                    continue

                await self.db.execute(
                    """
                    insert into activation_codes (code, code_hash, duration_days, status, batch_no)
                    values (:code, :code_hash, :duration_days, 'active', :batch_no)
                    """,
                    {
                        "code": code,
                        "code_hash": code_hash,
                        "duration_days": duration_days,
                        "batch_no": normalized_batch
                    }
                )
                used_hashes.add(code_hash)
                generated_items.append({
                    "code": code,
                    "durationDays": duration_days,
                    "status": "active",
                    "batchNo": normalized_batch
                })

        return {
            "batchNo": normalized_batch,
            "count": len(generated_items),
            "items": generated_items
        }

    async def list_activation_codes(self, limit: int = 200):
        if limit < 1 or limit > 1000:
            raise HTTPException(status_code=400, detail="limit must be between 1 and 1000")

        rows = await self.db.fetch_all(
            """
            select code, duration_days, status, batch_no, redeemed_at, created_at, expires_at
            from activation_codes
            order by created_at desc
            limit :limit
            """,
            {"limit": limit}
        )

        return {
            "items": [
                {
                    "code": row["code"],
                    "durationDays": row["duration_days"],
                    "status": row["status"],
                    "batchNo": row["batch_no"],
                    "redeemedAt": _to_iso(row["redeemed_at"]),
                    "createdAt": _to_iso(row["created_at"]),
                    "expiresAt": _to_iso(row["expires_at"])
                }
                for row in rows
            ]
        }

    async def redeem_license(self, activation_code: str):
        normalized_code = self._normalize_activation_code(activation_code)
        code_hash = hash_activation_code(normalized_code)
        existing_code = await self.db.fetch_one(
            """
            select code, duration_days, status, license_id, expires_at
            from activation_codes
            where code_hash = :code_hash
            """,
            {"code_hash": code_hash}
        )

        if not existing_code:
            raise HTTPException(status_code=401, detail="invalid activation code")

        if existing_code["status"] == "redeemed" or existing_code["license_id"]:
            raise HTTPException(status_code=401, detail="activation code already redeemed")

        if self._is_expired(existing_code["expires_at"]):
            raise HTTPException(status_code=401, detail="activation code expired")

        duration_days = int(existing_code["duration_days"] or 30)
        license_id = create_id("lic")
        license_token = create_id("ltok")
        expires_at = plus_days(duration_days)

        async with self.db.transaction():
            await self.db.execute(
                """
                insert into licenses (id, token, duration_days, expires_at)
                values (:id, :token, :duration_days, :expires_at)
                """,
                {
                    "id": license_id,
                    "token": license_token,
                    "duration_days": duration_days,
                    "expires_at": expires_at
                }
            )

            await self.db.execute(
                """
                update activation_codes
                set license_id = :license_id,
                    redeemed_at = current_timestamp,
                    status = 'redeemed'
                where code_hash = :code_hash
                """,
                {"code_hash": code_hash, "license_id": license_id}
            )

        return {
            "licenseId": license_id,
            "licenseToken": license_token,
            "durationDays": duration_days,
            "expiresAt": _to_iso(expires_at),
            "activationCode": existing_code["code"]
        }

    async def get_license_by_token(self, token: str):
        row = await self.db.fetch_one(
            "select id, token, duration_days, expires_at from licenses where token = :token",
            {"token": token}
        )
        if not row:
            raise HTTPException(status_code=401, detail="license not found")

        return {
            "licenseId": row["id"],
            "licenseToken": row["token"],
            "durationDays": row["duration_days"],
            "expiresAt": _to_iso(row["expires_at"])
        }

    async def get_current_license(self, authorization: str | None):
        token = self._get_bearer_token(authorization)
        return await self.get_license_by_token(token)

    async def get_device_by_token(self, authorization: str | None):
        token = self._get_bearer_token(authorization)
        row = await self.db.fetch_one(
            """
            select id, installation_id, status, license_id, extension_version, last_heartbeat_at
            from devices
            where device_token = :token
            """,
            {"token": token}
        )
        if not row:
            raise HTTPException(status_code=401, detail="device not found")

        return {
            "deviceId": row["id"],
            "installationId": row["installation_id"],
            "status": row["status"],
            "licenseId": row["license_id"],
            "extensionVersion": row["extension_version"],
            "lastHeartbeatAt": _to_iso(row["last_heartbeat_at"])
        }

    async def register_device(self, input_data: dict):
        existing = await self.db.fetch_one(
            "select id, device_token, status from devices where installation_id = :iid",
            {"iid": input_data["installationId"]}
        )
        if existing:
            return {
                "deviceId": existing["id"],
                "deviceToken": existing["device_token"],
                "status": existing["status"]
            }

        device_id = create_id("dev")
        device_token = create_id("dtok")

        await self.db.execute(
            """
            insert into devices (
                id, installation_id, device_token, status, license_id,
                browser_name, browser_version, os, extension_version
            )
            values (:id, :iid, :dtok, 'active', null, :bname, :bver, :os, :extver)
            """,
            {
                "id": device_id,
                "iid": input_data["installationId"],
                "dtok": device_token,
                "bname": input_data["browserName"],
                "bver": input_data["browserVersion"],
                "os": input_data["os"],
                "extver": input_data["extensionVersion"]
            }
        )

        return {
            "deviceId": device_id,
            "deviceToken": device_token,
            "status": "active"
        }

    async def bind_license(self, device_id: str, input_data: dict):
        license_info = await self.get_license_by_token(input_data["licenseToken"])
        await self.db.execute(
            "update devices set license_id = :lid where id = :did",
            {"lid": license_info["licenseId"], "did": device_id}
        )
        # Using execute, the result might not be the row count exactly in asyncpg via databases,
        # but let's assume it works for updating.
        return {
            "deviceId": device_id,
            "licenseId": license_info["licenseId"],
            "status": "bound"
        }

    async def heartbeat(self, device_id: str, input_data: dict, authorization: str | None):
        device = await self.get_device_by_token(authorization)
        if device["deviceId"] != device_id:
            raise HTTPException(status_code=401, detail="device mismatch")

        await self.db.execute(
            """
            update devices
            set last_heartbeat_at = current_timestamp,
                status = :status,
                browser_name = :browser_name,
                browser_version = :browser_version,
                os = :os,
                extension_version = :extension_version
            where id = :did
            """,
            {
                "status": input_data.get("status", device["status"]),
                "browser_name": input_data.get("browserName", "chrome"),
                "browser_version": input_data.get("browserVersion", "unknown"),
                "os": input_data.get("os", "unknown"),
                "extension_version": input_data.get("extensionVersion", "unknown"),
                "did": device_id
            }
        )

        return {
            "deviceId": device_id,
            "currentTaskId": input_data.get("currentTaskId"),
            "taskStatus": input_data.get("taskStatus"),
            "receivedAt": _to_iso(datetime.datetime.now(datetime.timezone.utc))
        }

    async def create_task(self, input_data: dict, authorization: str | None, admin_token: str | None = None):
        license_info = await self._resolve_management_license(authorization, admin_token)
        platform = detect_platform(input_data["sourceUrl"])
        task_id = create_id("task")
        task_token = create_id("ttok")
        created_at = datetime.datetime.now(datetime.timezone.utc)

        await self.db.execute(
            """
            insert into tasks (
                id, license_id, device_id, task_token, platform, status, source_url, canonical_url, created_at
            )
            values (:id, :lid, null, :ttok, :plat, 'pending', :url, :url, :cat)
            """,
            {
                "id": task_id,
                "lid": license_info["licenseId"],
                "ttok": task_token,
                "plat": platform,
                "url": input_data["sourceUrl"],
                "cat": created_at
            }
        )

        return {
            "taskId": task_id,
            "platform": platform,
            "status": "pending",
            "sourceUrl": input_data["sourceUrl"],
            "canonicalUrl": input_data["sourceUrl"],
            "createdAt": _to_iso(created_at)
        }

    async def hydrate_task(self, row: dict):
        task_id = row["id"]
        assets_rows = await self.db.fetch_all(
            """
            select id, group_type, sku_name, source_url, preview_url, download_url, mime_type,
                   width, height, file_size, sort_order
            from task_assets
            where task_id = :tid
            order by group_type asc, sort_order asc
            """,
            {"tid": task_id}
        )

        archive_row = await self.db.fetch_one(
            """
            select archive_id, status, retention_days, download_url, file_size, expires_at
            from task_archives
            where task_id = :tid
            """,
            {"tid": task_id}
        )

        assets = {
            "main": [],
            "sku": [],
            "detail": [],
            "other": []
        }

        for asset in assets_rows:
            group_type = asset["group_type"]
            if group_type not in assets:
                assets[group_type] = []
                
            assets[group_type].append({
                "assetId": asset["id"],
                "groupType": group_type,
                "skuName": asset["sku_name"],
                "sourceUrl": asset["source_url"],
                "previewUrl": asset["preview_url"],
                "downloadUrl": asset["download_url"],
                "mimeType": asset["mime_type"],
                "width": asset["width"],
                "height": asset["height"],
                "fileSize": asset["file_size"],
                "sortOrder": asset["sort_order"]
            })

        return {
            "taskId": task_id,
            "platform": row["platform"],
            "status": row["status"],
            "sourceUrl": row["source_url"],
            "canonicalUrl": row["canonical_url"],
            "title": row["title"],
            "productId": row["product_id"],
            "errorCode": row["error_code"],
            "errorMessage": row["error_message"],
            "extractorVersion": row["extractor_version"],
            "counts": {
                "main": len(assets["main"]),
                "sku": len(assets["sku"]),
                "detail": len(assets["detail"]),
                "other": len(assets["other"])
            },
            "assets": assets,
            "archive": {
                "archiveId": archive_row["archive_id"],
                "status": archive_row["status"],
                "retentionDays": archive_row["retention_days"],
                "downloadUrl": archive_row["download_url"],
                "fileSize": archive_row["file_size"],
                "expiresAt": _to_iso(archive_row["expires_at"])
            } if archive_row else {
                "status": "not_started"
            },
            "createdAt": _to_iso(row["created_at"]),
            "completedAt": _to_iso(row["completed_at"])
        }

    async def list_tasks(self, authorization: str | None, admin_token: str | None = None):
        license_info = await self._resolve_management_license(authorization, admin_token)
        rows = await self.db.fetch_all(
            """
            select id, platform, status, source_url, canonical_url, title, product_id, error_code,
                   error_message, extractor_version, created_at, completed_at
            from tasks
            where license_id = :lid
            order by created_at desc
            """,
            {"lid": license_info["licenseId"]}
        )
        return [await self.hydrate_task(row) for row in rows]

    async def get_task(self, task_id: str, authorization: str | None, admin_token: str | None = None):
        license_info = await self._resolve_management_license(authorization, admin_token)
        row = await self.db.fetch_one(
            """
            select id, platform, status, source_url, canonical_url, title, product_id, error_code,
                   error_message, extractor_version, created_at, completed_at
            from tasks
            where id = :tid and license_id = :lid
            """,
            {"tid": task_id, "lid": license_info["licenseId"]}
        )
        if not row:
            raise HTTPException(status_code=404, detail="task not found")
        return await self.hydrate_task(row)

    async def next_task(self, authorization: str | None):
        device = await self.get_device_by_token(authorization)
        if not device["licenseId"]:
            return None

        row = await self.db.fetch_one(
            """
            select id, platform, source_url, task_token
            from tasks
            where license_id = :lid and status = 'pending'
            order by created_at asc
            limit 1
            """,
            {"lid": device["licenseId"]}
        )
        if not row:
            return None

        return {
            "taskId": row["id"],
            "platform": row["platform"],
            "sourceUrl": row["source_url"],
            "taskToken": row["task_token"],
            "expiresAt": _to_iso(plus_days(1))
        }

    async def _get_task_record_by_token(self, task_id: str, task_token: str):
        row = await self.db.fetch_one(
            "select id, license_id, device_id from tasks where id = :tid and task_token = :ttok",
            {"tid": task_id, "ttok": task_token}
        )
        if not row:
            raise HTTPException(status_code=401, detail="task token invalid")
        return row

    async def claim_task(self, task_id: str, input_data: dict, authorization: str | None):
        device = await self.get_device_by_token(authorization)
        task = await self._get_task_record_by_token(task_id, input_data["taskToken"])

        if task["license_id"] != device["licenseId"]:
            raise HTTPException(status_code=401, detail="task not available for device")

        await self.db.execute(
            "update tasks set status = 'claimed', device_id = :did where id = :tid",
            {"did": device["deviceId"], "tid": task_id}
        )

        return {
            "taskId": task_id,
            "status": "claimed",
            "claimedAt": _to_iso(datetime.datetime.now(datetime.timezone.utc))
        }

    async def _assert_task_owned_by_device(self, task_id: str, task_token: str, device_id: str):
        task = await self._get_task_record_by_token(task_id, task_token)
        if task["device_id"] and task["device_id"] != device_id:
            raise HTTPException(status_code=401, detail="task owned by another device")

        if not task["device_id"]:
            await self.db.execute(
                "update tasks set device_id = :did where id = :tid",
                {"did": device_id, "tid": task_id}
            )

    async def update_task_progress(self, task_id: str, input_data: dict, authorization: str | None):
        device = await self.get_device_by_token(authorization)
        await self._assert_task_owned_by_device(task_id, input_data["taskToken"], device["deviceId"])

        await self.db.execute(
            "update tasks set status = :status where id = :tid",
            {"status": input_data["status"], "tid": task_id}
        )

        return {
            "taskId": task_id,
            "status": input_data["status"],
            "stage": input_data.get("stage"),
            "updatedAt": _to_iso(datetime.datetime.now(datetime.timezone.utc))
        }

    async def _get_task_by_id_without_auth(self, task_id: str):
        row = await self.db.fetch_one(
            """
            select id, platform, status, source_url, canonical_url, title, product_id, error_code,
                   error_message, extractor_version, created_at, completed_at
            from tasks
            where id = :tid
            """,
            {"tid": task_id}
        )
        if not row:
            raise HTTPException(status_code=404, detail="task not found")
        return await self.hydrate_task(row)

    async def submit_result(self, task_id: str, input_data: dict, authorization: str | None):
        device = await self.get_device_by_token(authorization)
        await self._assert_task_owned_by_device(task_id, input_data["taskToken"], device["deviceId"])

        async with self.db.transaction():
            await self.db.execute("delete from task_assets where task_id = :tid", {"tid": task_id})

            for group_type, assets in input_data.get("images", {}).items():
                for item in assets:
                    asset_id = create_id("asset")
                    await self.db.execute(
                        """
                        insert into task_assets (
                            id, task_id, group_type, sku_name, source_url, preview_url, download_url,
                            mime_type, width, height, file_size, sort_order
                        )
                        values (:id, :tid, :gtype, :sku, :url, :url, :url, :mime, :w, :h, :size, :sort)
                        """,
                        {
                            "id": asset_id,
                            "tid": task_id,
                            "gtype": group_type,
                            "sku": item.get("skuName"),
                            "url": item["sourceUrl"],
                            "mime": item.get("mimeType", "image/jpeg"),
                            "w": item.get("width"),
                            "h": item.get("height"),
                            "size": item.get("fileSize"),
                            "sort": item.get("sortOrder", 0)
                        }
                    )

            await self.db.execute(
                """
                update tasks
                set status = 'completed',
                    title = :title,
                    product_id = :pid,
                    canonical_url = :curl,
                    extractor_version = :ever,
                    completed_at = current_timestamp,
                    error_code = null,
                    error_message = null
                where id = :tid
                """,
                {
                    "title": input_data.get("title"),
                    "pid": input_data.get("productId"),
                    "curl": input_data.get("canonicalUrl", ""),
                    "ever": input_data.get("extractorVersion"),
                    "tid": task_id
                }
            )

        return await self._get_task_by_id_without_auth(task_id)

    async def submit_fail(self, task_id: str, input_data: dict, authorization: str | None):
        device = await self.get_device_by_token(authorization)
        await self._assert_task_owned_by_device(task_id, input_data["taskToken"], device["deviceId"])

        await self.db.execute(
            """
            update tasks
            set status = 'failed',
                error_code = :ecode,
                error_message = :emsg,
                completed_at = current_timestamp
            where id = :tid
            """,
            {
                "ecode": input_data.get("errorCode"),
                "emsg": input_data.get("errorMessage"),
                "tid": task_id
            }
        )

        return await self._get_task_by_id_without_auth(task_id)

    async def request_archive(self, task_id: str, input_data: dict, authorization: str | None, admin_token: str | None = None):
        await self.get_task(task_id, authorization, admin_token)
        retention_days = input_data.get("retentionDays", 7)
        archive_id = create_id("arc")
        # Fake download URL since we don't have the zip generation logic yet
        download_url = self.storage.generate_presigned_url(f"tasks/{task_id}/archive/{archive_id}.zip")

        await self.db.execute(
            """
            insert into task_archives (task_id, archive_id, status, retention_days, download_url, file_size, expires_at, updated_at)
            values (:tid, :aid, 'ready', :rdays, :durl, 1024, :expires, current_timestamp)
            on conflict (task_id)
            do update set
              archive_id = excluded.archive_id,
              status = excluded.status,
              retention_days = excluded.retention_days,
              download_url = excluded.download_url,
              file_size = excluded.file_size,
              expires_at = excluded.expires_at,
              updated_at = current_timestamp
            """,
            {
                "tid": task_id,
                "aid": archive_id,
                "rdays": retention_days,
                "durl": download_url,
                "expires": plus_days(retention_days)
            }
        )

        return await self.get_archive(task_id, authorization, admin_token)

    async def get_archive(self, task_id: str, authorization: str | None, admin_token: str | None = None):
        await self.get_task(task_id, authorization, admin_token)

        row = await self.db.fetch_one(
            "select archive_id, status, retention_days, download_url, file_size, expires_at from task_archives where task_id = :tid",
            {"tid": task_id}
        )

        if not row:
            return {
                "taskId": task_id,
                "status": "not_started"
            }

        return {
            "taskId": task_id,
            "archiveId": row["archive_id"],
            "status": row["status"],
            "retentionDays": row["retention_days"],
            "downloadUrl": row["download_url"],
            "fileSize": row["file_size"],
            "expiresAt": _to_iso(row["expires_at"])
        }

    async def convert_asset(self, asset_id: str, input_data: dict, authorization: str | None, admin_token: str | None = None):
        license_info = await self._resolve_management_license(authorization, admin_token)
        row = await self.db.fetch_one(
            """
            select ta.task_id, ta.group_type
            from task_assets ta
            join tasks t on t.id = ta.task_id
            where ta.id = :aid and t.license_id = :lid
            """,
            {"aid": asset_id, "lid": license_info["licenseId"]}
        )
        if not row:
            raise HTTPException(status_code=404, detail="asset not found")

        job_id = create_id("conv")
        # Fake download URL for now
        download_url = self.storage.generate_presigned_url(f"tasks/{row['task_id']}/assets/{asset_id}_{job_id}.{input_data['targetFormat']}")

        await self.db.execute(
            """
            insert into asset_convert_jobs (id, task_id, asset_id, asset_type, target_format, retention_days, status)
            values (:jid, :tid, :aid, null, :tfmt, :rdays, 'processing')
            """,
            {
                "jid": job_id,
                "tid": row["task_id"],
                "aid": asset_id,
                "tfmt": input_data["targetFormat"],
                "rdays": input_data.get("retentionDays", 1)
            }
        )

        return {
            "jobId": job_id,
            "assetId": asset_id,
            "targetFormat": input_data["targetFormat"],
            "retentionDays": input_data.get("retentionDays", 1),
            "status": "processing",
            "downloadUrl": download_url
        }

    async def convert_task(self, task_id: str, input_data: dict, authorization: str | None, admin_token: str | None = None):
        task = await self.get_task(task_id, authorization, admin_token)
        asset_type = input_data["assetType"]
        target_format = input_data["targetFormat"]
        retention_days = input_data.get("retentionDays", 1)
        
        jobs = []
        for asset in task["assets"].get(asset_type, []):
            job_id = create_id("conv")
            download_url = self.storage.generate_presigned_url(f"tasks/{task_id}/assets/{asset['assetId']}_{job_id}.{target_format}")
            jobs.append({
                "jobId": job_id,
                "assetId": asset["assetId"],
                "downloadUrl": download_url
            })

        for job in jobs:
            await self.db.execute(
                """
                insert into asset_convert_jobs (id, task_id, asset_id, asset_type, target_format, retention_days, status)
                values (:jid, :tid, :aid, :atype, :tfmt, :rdays, 'processing')
                """,
                {
                    "jid": job["jobId"],
                    "tid": task_id,
                    "aid": job["assetId"],
                    "atype": asset_type,
                    "tfmt": target_format,
                    "rdays": retention_days
                }
            )

        return {
            "taskId": task_id,
            "targetFormat": target_format,
            "assetType": asset_type,
            "retentionDays": retention_days,
            "jobCount": len(jobs),
            "status": "processing",
            "jobs": jobs
        }

    async def presign_uploads(self, input_data: dict, authorization: str | None):
        await self.get_device_by_token(authorization)
        await self._get_task_by_id_without_auth(input_data["taskId"])

        uploads = []
        for file in input_data["files"]:
            asset_id = create_id("asset")
            storage_key = f"tasks/{input_data['taskId']}/original/{asset_id}.{file['ext']}"
            upload_url = self.storage.generate_presigned_url(storage_key, method="PUT")
            access_url = self.storage.generate_presigned_url(storage_key, method="GET")

            uploads.append({
                "clientAssetId": file["clientAssetId"],
                "assetId": asset_id,
                "storageKey": storage_key,
                "method": "PUT",
                "uploadUrl": upload_url,
                "accessUrl": access_url
            })
        return {"uploads": uploads}

    async def complete_uploads(self, input_data: dict, authorization: str | None):
        await self.get_device_by_token(authorization)
        await self._get_task_by_id_without_auth(input_data["taskId"])

        uploads = []
        for upload in input_data["uploads"]:
            access_url = self.storage.generate_presigned_url(upload["storageKey"], method="GET")
            uploads.append({
                **upload,
                "accessUrl": access_url
            })

        return {
            "taskId": input_data["taskId"],
            "completedCount": len(uploads),
            "completedAt": _to_iso(datetime.datetime.now(datetime.timezone.utc)),
            "uploads": uploads
        }

store = DatabaseStore()
