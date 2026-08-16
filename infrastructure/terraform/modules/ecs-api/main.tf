resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${var.name_prefix}/api"
  retention_in_days = var.log_retention_days
  tags              = merge(var.tags, { Name = "${var.name_prefix}-api-logs" })
}

resource "aws_ecs_cluster" "this" {
  name = "${var.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "disabled" # demo cost save
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-cluster" })
}

resource "aws_iam_role" "execution" {
  name = "${var.name_prefix}-ecs-exec"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Pull secrets into the task definition
resource "aws_iam_role_policy" "execution_secrets" {
  count = length(var.secret_environment) > 0 ? 1 : 0

  name = "${var.name_prefix}-ecs-exec-secrets"
  role = aws_iam_role.execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = distinct(values(var.secret_environment))
    }]
  })
}

resource "aws_iam_role" "task" {
  name = "${var.name_prefix}-ecs-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = var.tags
}

locals {
  container_environment = [
    for k, v in var.plain_environment : {
      name  = k
      value = v
    }
  ]

  container_secrets = [
    for k, arn in var.secret_environment : {
      name      = k
      valueFrom = arn
    }
  ]

  container_definition = {
    name      = "api"
    image     = "${var.ecr_repository_url}:${var.image_tag}"
    essential = true

    portMappings = [{
      containerPort = var.container_port
      hostPort      = var.container_port
      protocol      = "tcp"
    }]

    environment = local.container_environment
    secrets     = local.container_secrets

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.api.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "api"
      }
    }

    # Demo: no healthCheck in container — ALB target group health is enough
  }
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.name_prefix}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.cpu)
  memory                   = tostring(var.memory)
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([local.container_definition])

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-api-td" })
}

# One-shot migrate task: same image/env/secrets, override command at run-time.
# Runtime image has no prisma CLI — document using a migrate image tag or
# override with a build-stage image. We still ship a sibling task def family
# so `aws ecs run-task` can target it with command override when image includes prisma.
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${var.name_prefix}-api-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name      = "migrate"
    image     = "${var.ecr_repository_url}:${var.image_tag}"
    essential = true

    environment = local.container_environment
    secrets     = local.container_secrets

    # Default command is a no-op placeholder; deploy workflow overrides with
    # the build-stage image + prisma migrate deploy. See README.
    command = ["node", "-e", "console.log('override command for prisma migrate deploy'); process.exit(1)"]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.api.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "migrate"
      }
    }
  }])

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-migrate-td" })
}

resource "aws_ecs_service" "api" {
  name            = "${var.name_prefix}-api"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  # Demo: allow first deploy before any image exists — service stays pending
  # until first push. enable_execute_command off for simplicity.
  enable_execute_command = false

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = var.security_group_ids
    assign_public_ip = var.assign_public_ip
  }

  load_balancer {
    target_group_arn = var.target_group_arn
    container_name   = "api"
    container_port   = var.container_port
  }

  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 120

  tags = merge(var.tags, { Name = "${var.name_prefix}-api-svc" })

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }
}
