output "primary_endpoint_address" {
  value     = aws_elasticache_replication_group.this.primary_endpoint_address
  sensitive = true
}

output "port" {
  value = aws_elasticache_replication_group.this.port
}

output "redis_url" {
  description = "REDIS_URL with TLS (rediss://) and AUTH — seed into Secrets Manager outside Terraform state"
  value = format(
    "rediss://:%s@%s:%s",
    var.auth_token,
    aws_elasticache_replication_group.this.primary_endpoint_address,
    tostring(aws_elasticache_replication_group.this.port)
  )
  sensitive = true
}
