variable "name_prefix" {
  type = string
}

variable "subnet_ids" {
  description = "Subnets for cache subnet group (private data subnets)"
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
  description = "Redis AUTH token (16–128 chars). Required; pair with transit encryption (rediss://)."
  type        = string
  sensitive   = true

  validation {
    condition = (
      length(var.auth_token) >= 16 &&
      length(var.auth_token) <= 128 &&
      can(regex("^[A-Za-z0-9!&#$^<>-]+$", var.auth_token))
    )
    error_message = "auth_token must be 16–128 characters and only contain alphanumeric or ! & # $ ^ < > - (ElastiCache AUTH charset)."
  }
}

variable "tags" {
  type    = map(string)
  default = {}
}
