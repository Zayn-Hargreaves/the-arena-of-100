output "alb_dns_name" {
  description = "Point Vercel NEXT_PUBLIC_API_URL to http://<this> (or https if enable_https)"
  value       = module.alb.alb_dns_name
}

output "api_base_url" {
  description = "Suggested API base URL for the web app"
  value       = var.enable_https && var.domain_name != "" ? "https://${var.domain_name}" : "http://${module.alb.alb_dns_name}"
}

output "ecr_repository_url" {
  value = module.ecr.repository_url
}

output "ecr_repository_name" {
  value = module.ecr.repository_name
}

output "rds_endpoint" {
  value     = module.postgres.endpoint
  sensitive = true
}

output "redis_endpoint" {
  value     = module.redis.primary_endpoint_address
  sensitive = true
}

output "ecs_cluster_name" {
  value = module.ecs_api.cluster_name
}

output "ecs_service_name" {
  value = module.ecs_api.service_name
}

output "ecs_task_definition_family" {
  value = module.ecs_api.task_definition_family
}

output "migrate_task_definition_family" {
  value = module.ecs_api.migrate_task_definition_family
}

output "gha_role_arn" {
  description = "Set as GitHub Actions secret AWS_ROLE_ARN"
  value       = module.gha_oidc.role_arn
}

output "vpc_id" {
  value = module.networking.vpc_id
}

output "public_subnet_ids" {
  value = module.networking.public_subnet_ids
}

output "ecs_security_group_id" {
  value = module.networking.ecs_security_group_id
}

output "log_group_name" {
  value = module.ecs_api.log_group_name
}

output "secret_arns" {
  value     = module.secrets.secret_arns
  sensitive = true
}
