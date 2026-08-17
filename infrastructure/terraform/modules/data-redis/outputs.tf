output "primary_endpoint_address" {
  value     = aws_elasticache_replication_group.this.primary_endpoint_address
  sensitive = true
}

output "port" {
  value = aws_elasticache_replication_group.this.port
}

# Optional operator helper — do not re-export at root (password in URL).
# AUTH is percent-encoded so tokens containing # & etc. remain valid in rediss:// URIs.
output "redis_url" {
  description = "REDIS_URL with TLS (rediss://) and urlencoded AUTH — for operator use only; seed SM outside Terraform; do not root-output"
  value = format(
    "rediss://:%s@%s:%s",
    urlencode(var.auth_token),
    aws_elasticache_replication_group.this.primary_endpoint_address,
    tostring(aws_elasticache_replication_group.this.port)
  )
  sensitive = true
}
