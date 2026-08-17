# Secret shells only — plaintext values are NEVER written by Terraform.
# Seed versions after apply via CI OIDC or aws cli (see terraform README).

resource "aws_secretsmanager_secret" "this" {
  for_each = var.secret_keys

  name                    = "${var.name_prefix}/${each.key}"
  recovery_window_in_days = 0 # demo: immediate delete on destroy
  tags                    = merge(var.tags, { Name = "${var.name_prefix}/${each.key}" })
}
