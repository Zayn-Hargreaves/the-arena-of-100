output "primary_endpoint_address" {
  value     = aws_elasticache_replication_group.this.primary_endpoint_address
  sensitive = true
}

output "port" {
  value = aws_elasticache_replication_group.this.port
}

output "redis_url" {
  description = "REDIS_URL value (with auth if configured)"
  value = var.auth_token != "" ? format(
    "rediss://:%s@%s:%s",
    var.auth_token,
    aws_elasticache_replication_group.this.primary_endpoint_address,
    tostring(aws_elasticache_replication_group.this.port)
    ) : format(
    "redis://%s:%s",
    aws_elasticache_replication_group.this.primary_endpoint_address,
    tostring(aws_elasticache_replication_group.this.port)
  )
  sensitive = true
}
