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
  nullable    = false
  sensitive   = true

  validation {
    condition = (
      length(var.auth_token) >= 16 &&
      length(var.auth_token) <= 128 &&
      can(regex("^[A-Za-z0-9!&#$^<>-]+$", var.auth_token)) &&
      (
        (can(regex("[A-Z]", var.auth_token)) ? 1 : 0) +
        (can(regex("[a-z]", var.auth_token)) ? 1 : 0) +
        (can(regex("[0-9]", var.auth_token)) ? 1 : 0) +
        (can(regex("[!&#$^<>-]", var.auth_token)) ? 1 : 0)
      ) >= 3
    )
    error_message = "auth_token must be 16–128 characters, only alphanumeric or ! & # $ ^ < > - (ElastiCache AUTH charset), and include at least 3 of: uppercase, lowercase, digit, non-alphanumeric."
  }
}

variable "tags" {
  type    = map(string)
  default = {}
}
