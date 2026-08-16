variable "name_prefix" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "security_group_ids" {
  type = list(string)
}

variable "enable_https" {
  description = "When true (default), HTTP redirects to HTTPS and certificate_arn is required."
  type        = bool
  default     = true
}

variable "certificate_arn" {
  description = "ACM cert ARN in this region (required when enable_https=true — enforced by module precondition)"
  type        = string
  default     = ""
}

variable "health_check_path" {
  type    = string
  default = "/api/v1/health"
}

variable "target_port" {
  type    = number
  default = 3001
}

variable "idle_timeout" {
  description = "ALB idle timeout seconds (WebSocket-friendly)"
  type        = number
  default     = 3600
}

variable "tags" {
  type    = map(string)
  default = {}
}
