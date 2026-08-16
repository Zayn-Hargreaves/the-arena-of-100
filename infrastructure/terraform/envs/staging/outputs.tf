output "alb_dns_name" {
  description = "ALB DNS — use only behind HTTPS custom domain for Vercel clients"
  value       = module.alb.alb_dns_name
}

output "api_base_url" {
  description = "Suggested API base URL for the web app (HTTPS + domain required for Vercel)"
  value       = var.enable_https && var.domain_name != "" ? "https://${var.domain_name}" : (var.enable_https ? "https://${module.alb.alb_dns_name}" : "http://${module.alb.alb_dns_name}")
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
  description = "Deploy role — GitHub secret AWS_ROLE_ARN; protect Environment staging (main + approval)"
  value       = module.gha_oidc.role_arn
}

output "gha_plan_role_arn" {
  description = "Read-only plan role — GitHub secret AWS_ROLE_ARN_PLAN"
  value       = module.gha_oidc.plan_role_arn
}

output "vpc_id" {
  value = module.networking.vpc_id
}

output "public_subnet_ids" {
  value = module.networking.public_subnet_ids
}

output "private_data_subnet_ids" {
  value = module.networking.private_data_subnet_ids
}

output "ecs_security_group_id" {
  value = module.networking.ecs_security_group_id
}

output "log_group_name" {
  value = module.ecs_api.log_group_name
}

output "secret_arns" {
  description = "Secret shell ARNs — seed versions outside Terraform"
  value       = module.secrets.secret_arns
  sensitive   = true
}

output "secret_names" {
  description = "Secret names for aws secretsmanager put-secret-value"
  value       = module.secrets.secret_names
}

# Sensitive helpers for operators seeding SM (do not commit output files)
output "seed_database_url" {
  description = "Suggested DATABASE_URL to put-secret-value (sensitive)"
  value       = local.database_url
  sensitive   = true
}

output "seed_redis_url" {
  description = "Suggested REDIS_URL (rediss:// + AUTH) to put-secret-value (sensitive)"
  value       = module.redis.redis_url
  sensitive   = true
}

output "seed_jwt_secret" {
  description = "JWT secret from tfvars — put-secret-value into JWT_SECRET shell (sensitive)"
  value       = var.jwt_secret
  sensitive   = true
}
