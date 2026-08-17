output "alb_arn" {
  value = aws_lb.this.arn
}

output "alb_dns_name" {
  value = aws_lb.this.dns_name
}

output "alb_zone_id" {
  value = aws_lb.this.zone_id
}

# Depend on listener(s) so consumers (ECS service) only see the TG after it
# is attached to the ALB — avoids races on first apply.
output "target_group_arn" {
  value = aws_lb_target_group.api.arn

  depends_on = [
    aws_lb_listener.http,
    aws_lb_listener.https,
  ]
}

output "http_listener_arn" {
  value = aws_lb_listener.http.arn
}

output "https_listener_arn" {
  value = try(aws_lb_listener.https[0].arn, null)
}
