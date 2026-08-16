data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

locals {
  azs  = slice(data.aws_availability_zones.available.names, 0, 2)
  tags = {}

  migrate_image_uri = var.migrate_image_uri != "" ? var.migrate_image_uri : "${module.ecr.repository_url}:${var.migrate_image_tag}"

  # ARNs for gha-oidc remote-state IAM scoping (match backend.tf key; locks via DynamoDB)
  tf_state_bucket_arn  = "arn:aws:s3:::${var.tf_state_bucket}"
  tf_state_objects_arn = "arn:aws:s3:::${var.tf_state_bucket}/arena-of-100/staging/terraform.tfstate"
  tf_lock_table_arn    = "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/${var.tf_lock_table}"
}

module "networking" {
  source = "../../modules/networking"

  name_prefix = var.name_prefix
  vpc_cidr    = var.vpc_cidr
  azs         = local.azs
  tags        = local.tags
}

module "postgres" {
  source = "../../modules/data-postgres"

  name_prefix             = var.name_prefix
  subnet_ids              = module.networking.private_data_subnet_ids
  security_group_ids      = [module.networking.rds_security_group_id]
  db_name                 = var.db_name
  db_username             = var.db_username
  db_password             = var.db_password
  instance_class          = "db.t4g.micro"
  allocated_storage       = 20
  backup_retention_period = 1
  skip_final_snapshot     = true
  deletion_protection     = false
  tags                    = local.tags
}

module "redis" {
  source = "../../modules/data-redis"

  name_prefix        = var.name_prefix
  subnet_ids         = module.networking.private_data_subnet_ids
  security_group_ids = [module.networking.redis_security_group_id]
  node_type          = "cache.t4g.micro"
  auth_token         = var.redis_auth_token
  tags               = local.tags
}

module "ecr" {
  source = "../../modules/ecr"

  repository_name = var.ecr_repository_name
  tags            = local.tags
}

# Secret shells only — seed DATABASE_URL / REDIS_URL / JWT_SECRET after apply
# (see README). Values must not live in Terraform state via secret_version.
module "secrets" {
  source = "../../modules/secrets"

  name_prefix = var.name_prefix
  tags        = local.tags

  secret_keys = toset(["DATABASE_URL", "REDIS_URL", "JWT_SECRET"])
}

module "alb" {
  source = "../../modules/alb"

  name_prefix        = var.name_prefix
  vpc_id             = module.networking.vpc_id
  subnet_ids         = module.networking.public_subnet_ids
  security_group_ids = [module.networking.alb_security_group_id]
  enable_https       = var.enable_https
  certificate_arn    = var.certificate_arn
  health_check_path  = "/api/v1/health"
  target_port        = 3001
  idle_timeout       = 3600
  tags               = local.tags
}

module "ecs_api" {
  source = "../../modules/ecs-api"

  name_prefix        = var.name_prefix
  aws_region         = var.aws_region
  vpc_id             = module.networking.vpc_id
  subnet_ids         = [module.networking.primary_subnet_id]
  security_group_ids = [module.networking.ecs_security_group_id]
  target_group_arn   = module.alb.target_group_arn
  ecr_repository_url = module.ecr.repository_url
  image_tag          = var.image_tag
  migrate_image_uri  = local.migrate_image_uri
  cpu                = var.api_cpu
  memory             = var.api_memory
  desired_count      = var.api_desired_count
  assign_public_ip   = true # demo: no NAT (~$32/mo saved); reaches private data via VPC
  log_retention_days = 7
  tags               = local.tags

  # Listeners must exist before the service attaches to the target group
  depends_on = [module.alb]

  plain_environment = {
    NODE_ENV           = "production"
    PORT               = "3001"
    DATABASE_SSL       = "true"
    CORS_ORIGIN        = var.cors_origin
    JWT_EXPIRES_IN     = var.jwt_expires_in
    REFRESH_EXPIRES_IN = var.refresh_expires_in
    INSTANCE_ID        = "staging-api-1"
    CROSS_SITE_COOKIES = "true"
  }

  secret_environment = {
    DATABASE_URL = module.secrets.secret_arns["DATABASE_URL"]
    REDIS_URL    = module.secrets.secret_arns["REDIS_URL"]
    JWT_SECRET   = module.secrets.secret_arns["JWT_SECRET"]
  }
}

module "gha_oidc" {
  source = "../../modules/gha-oidc"

  name_prefix             = var.name_prefix
  github_org              = var.github_org
  github_repo             = var.github_repo
  create_oidc_provider    = var.create_github_oidc_provider
  ecr_repository_arn      = module.ecr.repository_arn
  ecs_cluster_arn         = module.ecs_api.cluster_arn
  ecs_service_arn         = module.ecs_api.service_id
  task_execution_role_arn = module.ecs_api.execution_role_arn
  task_role_arn           = module.ecs_api.task_role_arn
  tf_state_bucket_arn     = local.tf_state_bucket_arn
  tf_state_objects_arn    = local.tf_state_objects_arn
  tf_lock_table_arn       = local.tf_lock_table_arn
  tags                    = local.tags
}

# Optional alias A/AAAA for custom domain → ALB (only if both set)
resource "aws_route53_record" "api" {
  count = var.domain_name != "" && var.route53_zone_id != "" ? 1 : 0

  zone_id = var.route53_zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = module.alb.alb_dns_name
    zone_id                = module.alb.alb_zone_id
    evaluate_target_health = true
  }
}
