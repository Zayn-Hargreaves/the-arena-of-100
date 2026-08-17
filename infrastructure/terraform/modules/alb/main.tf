# Public ALB defaults to HTTPS; lifecycle.precondition rejects empty cert when enable_https.
locals {
  certificate_arn = trimspace(var.certificate_arn)
  # Staging ALB is internet-facing; keep symbol so HTTP-only stays valid only if internal.
  internal = false
}

resource "aws_lb" "this" {
  name               = "${var.name_prefix}-alb"
  internal           = local.internal
  load_balancer_type = "application"
  security_groups    = var.security_group_ids
  subnets            = var.subnet_ids

  idle_timeout               = var.idle_timeout
  enable_deletion_protection = false
  drop_invalid_header_fields = true

  tags = merge(var.tags, { Name = "${var.name_prefix}-alb" })

  lifecycle {
    precondition {
      condition     = local.internal || var.enable_https
      error_message = "Public ALBs require enable_https = true. HTTP-only is allowed only for internal load balancers."
    }
    precondition {
      condition     = !var.enable_https || length(local.certificate_arn) > 0
      error_message = "certificate_arn must be a non-empty ACM ARN when enable_https is true. HTTP-only is not the default for public ALBs."
    }
  }
}

resource "aws_lb_target_group" "api" {
  # name_prefix required with create_before_destroy (fixed name collides on replace)
  name_prefix = substr(replace(var.name_prefix, "-", ""), 0, 6)
  port        = var.target_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  deregistration_delay = 30

  health_check {
    enabled             = true
    path                = var.health_check_path
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  stickiness {
    type            = "lb_cookie"
    cookie_duration = 86400
    enabled         = true
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-api-tg" })

  lifecycle {
    create_before_destroy = true
  }
}

# HTTP: forward when HTTPS off; redirect to HTTPS when cert present
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  dynamic "default_action" {
    for_each = var.enable_https && local.certificate_arn != "" ? [1] : []
    content {
      type = "redirect"
      redirect {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }

  dynamic "default_action" {
    for_each = var.enable_https && local.certificate_arn != "" ? [] : [1]
    content {
      type             = "forward"
      target_group_arn = aws_lb_target_group.api.arn
    }
  }
}

resource "aws_lb_listener" "https" {
  count = var.enable_https && local.certificate_arn != "" ? 1 : 0

  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = local.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}
