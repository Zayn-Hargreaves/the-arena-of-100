resource "aws_secretsmanager_secret" "this" {
  for_each = var.secret_keys

  name                    = "${var.name_prefix}/${each.key}"
  recovery_window_in_days = 0 # demo: immediate delete on destroy
  tags                    = merge(var.tags, { Name = "${var.name_prefix}/${each.key}" })
}

resource "aws_secretsmanager_secret_version" "this" {
  for_each = var.secret_keys

  secret_id     = aws_secretsmanager_secret.this[each.key].id
  secret_string = var.secret_values[each.key]
}
