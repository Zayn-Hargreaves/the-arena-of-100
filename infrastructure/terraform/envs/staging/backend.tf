# Default: local state — fastest path for a 3–5 day demo.
# State file lives at envs/staging/terraform.tfstate (gitignored).
#
# To switch to S3 + DynamoDB locking later:
#   1. Apply infrastructure/terraform/backend/ (optional bootstrap)
#   2. Uncomment the backend "s3" block below
#   3. terraform init -migrate-state

terraform {
  backend "local" {
    path = "terraform.tfstate"
  }

  # backend "s3" {
  #   bucket         = "YOUR_TF_STATE_BUCKET"
  #   key            = "arena-of-100/staging/terraform.tfstate"
  #   region         = "ap-southeast-1"
  #   dynamodb_table = "YOUR_TF_LOCK_TABLE"
  #   encrypt        = true
  # }
}
