variable "name_prefix" {
  type = string
}

variable "secret_keys" {
  description = "Non-sensitive set of secret name suffixes (for_each keys)"
  type        = set(string)
}

variable "secret_values" {
  description = "Map of secret name suffix → plaintext (must include every secret_keys entry)"
  type        = map(string)
  sensitive   = true
}

variable "tags" {
  type    = map(string)
  default = {}
}
