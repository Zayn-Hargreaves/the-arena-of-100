variable "name_prefix" {
  type = string
}

variable "github_org" {
  description = "GitHub org or user that owns the repo"
  type        = string
}

variable "github_repo" {
  description = "Repository name (without org)"
  type        = string
}

variable "create_oidc_provider" {
  description = "Set false if account already has token.actions.githubusercontent.com OIDC provider"
  type        = bool
  default     = true
}

variable "ecr_repository_arn" {
  type = string
}

variable "ecs_cluster_arn" {
  type = string
}

variable "ecs_service_arn" {
  description = "Full ARN of the API ECS service"
  type        = string
}

variable "task_execution_role_arn" {
  type = string
}

variable "task_role_arn" {
  type = string
}

variable "tf_state_bucket_arn" {
  description = "S3 bucket ARN for Terraform state (bucket-level actions)"
  type        = string
}

variable "tf_state_objects_arn" {
  description = "S3 object ARN prefix for Terraform state (e.g. arn:aws:s3:::bucket/*)"
  type        = string
}

variable "tf_lock_table_arn" {
  description = "DynamoDB lock table ARN for Terraform state locking"
  type        = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
