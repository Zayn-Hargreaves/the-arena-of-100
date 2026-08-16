variable "name_prefix" {
  type = string
}

variable "subnet_ids" {
  description = "Subnets for cache subnet group"
  type        = list(string)
}

variable "security_group_ids" {
  type = list(string)
}

variable "node_type" {
  type    = string
  default = "cache.t4g.micro"
}

variable "auth_token" {
  description = "Redis AUTH token (16–128 chars). Empty = no auth (demo only)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "tags" {
  type    = map(string)
  default = {}
}
