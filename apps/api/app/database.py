import os
import uuid
import datetime
import hashlib
from fastapi import HTTPException
import databases
import sqlalchemy

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./test.db")

database = databases.Database(DATABASE_URL)
metadata = sqlalchemy.MetaData()

def create_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"

def plus_days(days: int) -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=days)

def detect_platform(source_url: str) -> str:
    from urllib.parse import urlparse
    try:
        hostname = urlparse(source_url).hostname.lower()
    except Exception:
        raise HTTPException(status_code=404, detail="invalid source url")

    is_taobao = hostname in ["m.tb.cn", "e.tb.cn", "tmall.com", "taobao.com"] or \
                hostname.endswith(".tmall.com") or \
                hostname.endswith(".taobao.com")
                
    if is_taobao:
        return "taobao"

    is_1688 = hostname == "1688.com" or hostname.endswith(".1688.com")
    if is_1688:
        return "1688"
        
    is_pinduoduo = hostname in ["pinduoduo.com", "yangkeduo.com", "mobile.yangkeduo.com"] or \
                   hostname.endswith(".pinduoduo.com") or \
                   hostname.endswith(".yangkeduo.com")
    if is_pinduoduo:
        return "pinduoduo"
        
    raise HTTPException(status_code=404, detail="unsupported platform")


def hash_activation_code(code: str) -> str:
    normalized = (code or "").strip().upper()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()

# We define the schema just to ensure it matches the Postgres DB schema.
SCHEMA_SQL = """
create table if not exists activation_codes (
  code text primary key,
  code_hash text unique,
  duration_days integer not null default 30,
  status text not null default 'active',
  batch_no text,
  expires_at timestamp,
  license_id text unique,
  redeemed_at timestamp,
  created_at timestamp not null default current_timestamp
);

create table if not exists licenses (
  id text primary key,
  token text not null unique,
  duration_days integer not null,
  expires_at timestamp not null,
  created_at timestamp not null default current_timestamp
);

create table if not exists devices (
  id text primary key,
  installation_id text not null unique,
  device_token text not null unique,
  status text not null,
  license_id text references licenses(id),
  browser_name text not null,
  browser_version text not null,
  os text not null,
  extension_version text not null,
  last_heartbeat_at timestamp,
  created_at timestamp not null default current_timestamp
);

create table if not exists tasks (
  id text primary key,
  license_id text not null references licenses(id),
  device_id text references devices(id),
  task_token text not null unique,
  platform text not null,
  status text not null,
  source_url text not null,
  canonical_url text not null,
  title text,
  product_id text,
  error_code text,
  error_message text,
  extractor_version text,
  created_at timestamp not null default current_timestamp,
  completed_at timestamp
);

create index if not exists idx_tasks_license_created_at on tasks(license_id, created_at desc);
create index if not exists idx_tasks_status_created_at on tasks(status, created_at asc);
create unique index if not exists idx_activation_codes_code_hash on activation_codes(code_hash);

create table if not exists task_assets (
  id text primary key,
  task_id text not null references tasks(id) on delete cascade,
  group_type text not null,
  sku_name text,
  source_url text not null,
  preview_url text,
  download_url text,
  mime_type text not null,
  width integer,
  height integer,
  file_size integer,
  sort_order integer not null,
  created_at timestamp not null default current_timestamp
);

create index if not exists idx_task_assets_task_group_sort on task_assets(task_id, group_type, sort_order);

create table if not exists task_archives (
  task_id text primary key references tasks(id) on delete cascade,
  archive_id text not null unique,
  status text not null,
  retention_days integer,
  download_url text,
  file_size integer,
  expires_at timestamp,
  updated_at timestamp not null default current_timestamp
);

create table if not exists asset_convert_jobs (
  id text primary key,
  task_id text not null references tasks(id) on delete cascade,
  asset_id text references task_assets(id) on delete cascade,
  asset_type text,
  target_format text not null,
  retention_days integer not null,
  status text not null,
  created_at timestamp not null default current_timestamp
);
"""

async def ensure_activation_code_schema():
    columns = await database.fetch_all("PRAGMA table_info(activation_codes)")
    column_names = {row["name"] for row in columns}

    if "code_hash" not in column_names:
        await database.execute("alter table activation_codes add column code_hash text")
    if "duration_days" not in column_names:
        await database.execute("alter table activation_codes add column duration_days integer not null default 30")
    if "status" not in column_names:
        await database.execute("alter table activation_codes add column status text not null default 'active'")
    if "batch_no" not in column_names:
        await database.execute("alter table activation_codes add column batch_no text")
    if "expires_at" not in column_names:
        await database.execute("alter table activation_codes add column expires_at timestamp")

    await database.execute(
        """
        update activation_codes
        set duration_days = 30
        where duration_days is null
        """
    )
    await database.execute(
        """
        update activation_codes
        set status = case
          when license_id is not null then 'redeemed'
          else 'active'
        end
        where status is null or status = ''
        """
    )

    rows_without_hash = await database.fetch_all(
        """
        select code
        from activation_codes
        where code_hash is null or code_hash = ''
        """
    )
    for row in rows_without_hash:
        code = row["code"]
        await database.execute(
            """
            update activation_codes
            set code_hash = :code_hash
            where code = :code
            """,
            {
                "code": code,
                "code_hash": hash_activation_code(code)
            }
        )

    await database.execute(
        "create unique index if not exists idx_activation_codes_code_hash on activation_codes(code_hash)"
    )


async def init_db():
    await database.connect()
    # In a real production setup you might want to use Alembic for migrations
    # For now, we just execute the schema SQL
    for statement in SCHEMA_SQL.split(';'):
        if statement.strip():
            try:
                await database.execute(statement)
            except Exception as e:
                print(f"Error executing schema statement: {e}")
    await ensure_activation_code_schema()

async def close_db():
    await database.disconnect()
