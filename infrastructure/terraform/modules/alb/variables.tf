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
  type    = bool
  default = false
}

variable "certificate_arn" {
  description = "ACM cert ARN when enable_https=true"
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
