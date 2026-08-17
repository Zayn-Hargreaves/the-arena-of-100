# Encrypted S3 remote backend with DynamoDB locking (mandatory).
#
# Bootstrap first (creates bucket + lock table):
#   cd infrastructure/terraform/backend
#   terraform init && terraform apply -var="state_bucket_name=YOUR_UNIQUE_BUCKET"
#   terraform output -raw backend_config_snippet
#
# Partial backend: key/region/encrypt are fixed here; pass bucket + lock table
# via -backend-config (CI vars TF_STATE_BUCKET / TF_LOCK_TABLE, or local flags).
# See README for local init examples.
#
# Do not use a local backend — local state/plans may contain plaintext
# DB passwords, JWT material, and other secrets.

terraform {
  backend "s3" {
    # bucket and dynamodb_table supplied via -backend-config (partial config).
    # Values come from the backend module's backend_config_snippet output.
    key     = "arena-of-100/staging/terraform.tfstate"
    region  = "ap-southeast-1"
    encrypt = true
  }
}
