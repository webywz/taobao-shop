import os
import boto3
import uuid
import logging

class OssStorageService:
    def __init__(self):
        self.logger = logging.getLogger(__name__)
        # Default bucket name for dev environment
        self.bucket = os.environ.get("OSS_BUCKET", "tb-pdd-image")
        self.region = os.environ.get("OSS_REGION", "cn-hangzhou")
        
        # Configure the S3 client for Alibaba Cloud OSS
        # In a real app, use the correct endpoint like oss-cn-hangzhou.aliyuncs.com
        endpoint_url = os.environ.get("OSS_ENDPOINT", "http://127.0.0.1:9000")
        
        self.s3_client = boto3.client(
            's3',
            endpoint_url=endpoint_url,
            aws_access_key_id=os.environ.get("OSS_ACCESS_KEY_ID", "minioadmin"),
            aws_secret_access_key=os.environ.get("OSS_ACCESS_KEY_SECRET", "minioadmin"),
            config=boto3.session.Config(signature_version='s3v4')
        )

    def generate_presigned_url(self, key: str, expires_in: int = 3600) -> str:
        """Generate a presigned URL for downloading a file."""
        try:
            url = self.s3_client.generate_presigned_url(
                'get_object',
                Params={'Bucket': self.bucket, 'Key': key},
                ExpiresIn=expires_in
            )
            return url
        except Exception as e:
            self.logger.error(f"Error generating presigned url: {e}")
            return ""

    def generate_presigned_post(self, key: str, content_type: str, expires_in: int = 3600):
        """Generate a presigned POST for uploading a file."""
        try:
            response = self.s3_client.generate_presigned_post(
                Bucket=self.bucket,
                Key=key,
                Fields={'Content-Type': content_type},
                Conditions=[
                    {'Content-Type': content_type},
                    ['content-length-range', 0, 104857600] # Max 100MB
                ],
                ExpiresIn=expires_in
            )
            return response
        except Exception as e:
            self.logger.error(f"Error generating presigned post: {e}")
            return None

oss_storage = OssStorageService()
