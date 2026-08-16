# Encrypted S3 remote backend with DynamoDB locking (mandatory).
#
# Bootstrap first (creates bucket + lock table):
#   cd infrastructure/terraform/backend
#   terraform init && terraform apply -var="state_bucket_name=YOUR_UNIQUE_BUCKET"
#   terraform output backend_config_snippet
#
# Then replace the TODO placeholders below and run:
#   cd infrastructure/terraform/envs/staging
#   terraform init -migrate-state
#
# Do not use a local backend — local state/plans may contain plaintext
# DB passwords, JWT material, and other secrets.

terraform {
  backend "s3" {
    # TODO: set from backend module output `state_bucket`
    bucket = "TODO_TF_STATE_BUCKET"
    key    = "arena-of-100/staging/terraform.tfstate"
    region = "ap-southeast-1"
    # TODO: set from backend module output `lock_table`
    dynamodb_table = "TODO_TF_LOCK_TABLE"
    encrypt        = true
  }
}
