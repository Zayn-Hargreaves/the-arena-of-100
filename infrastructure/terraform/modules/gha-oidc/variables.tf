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

variable "tags" {
  type    = map(string)
  default = {}
}
