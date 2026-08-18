#!/bin/bash
URL="http://localhost:8788/terraform/plan"
run() {
  local name="$1"; local expect="$2"; local data="$3"
  local out
  out=$(curl -s -X POST "$URL" -H 'Content-Type: application/json' -d "$data")
  echo "[$name] expect=$expect got=$out"
}

BASE='"environment":"prod-mnu3ks","state":{"backend":"gcs","locked":true},"providerVersion":"~> 6.0","destroyApproved":false'
RES_OK='"resource":{"address":"google_storage_bucket.data","type":"storage_bucket","action":"create","labels":{"owner":"student-3e7hk","environment":"production","cost_center":"cc-1wbe"},"secret":null,"forceDestroy":false}'

# 1) INVALID_PLAN — missing environment
run "missing-environment" "INVALID_PLAN" "{\"state\":{\"backend\":\"gcs\",\"locked\":true},\"providerVersion\":\"~> 6.0\",\"destroyApproved\":false,$RES_OK}"

# 1) INVALID_PLAN — locked wrong type
run "locked-wrong-type" "INVALID_PLAN" "{\"environment\":\"prod-mnu3ks\",\"state\":{\"backend\":\"gcs\",\"locked\":\"true\"},\"providerVersion\":\"~> 6.0\",\"destroyApproved\":false,$RES_OK}"

# 1) INVALID_PLAN — bad action enum
run "bad-action-enum" "INVALID_PLAN" "{$BASE,\"resource\":{\"address\":\"a\",\"type\":\"storage_bucket\",\"action\":\"destroy\",\"labels\":{\"owner\":\"student-3e7hk\",\"environment\":\"production\",\"cost_center\":\"cc-1wbe\"},\"secret\":null,\"forceDestroy\":false}}"

# 1) INVALID_PLAN — labels value not string
run "labels-not-string" "INVALID_PLAN" "{$BASE,\"resource\":{\"address\":\"a\",\"type\":\"storage_bucket\",\"action\":\"create\",\"labels\":{\"owner\":123,\"environment\":\"production\",\"cost_center\":\"cc-1wbe\"},\"secret\":null,\"forceDestroy\":false}}"

# 1) INVALID_PLAN — forceDestroy wrong type
run "forcedestroy-wrong-type" "INVALID_PLAN" "{$BASE,\"resource\":{\"address\":\"a\",\"type\":\"storage_bucket\",\"action\":\"create\",\"labels\":{\"owner\":\"student-3e7hk\",\"environment\":\"production\",\"cost_center\":\"cc-1wbe\"},\"secret\":null,\"forceDestroy\":\"false\"}}"

# 2) ENVIRONMENT_MISMATCH
run "env-mismatch" "ENVIRONMENT_MISMATCH" "{\"environment\":\"prod-other\",\"state\":{\"backend\":\"gcs\",\"locked\":true},\"providerVersion\":\"~> 6.0\",\"destroyApproved\":false,$RES_OK}"

# 3) STATE_UNSAFE — bad backend
run "state-bad-backend" "STATE_UNSAFE" "{\"environment\":\"prod-mnu3ks\",\"state\":{\"backend\":\"local\",\"locked\":true},\"providerVersion\":\"~> 6.0\",\"destroyApproved\":false,$RES_OK}"

# 3) STATE_UNSAFE — not locked
run "state-not-locked" "STATE_UNSAFE" "{\"environment\":\"prod-mnu3ks\",\"state\":{\"backend\":\"gcs\",\"locked\":false},\"providerVersion\":\"~> 6.0\",\"destroyApproved\":false,$RES_OK}"

# 4) UNPINNED_PROVIDER — >=
run "provider-gte" "UNPINNED_PROVIDER" "{\"environment\":\"prod-mnu3ks\",\"state\":{\"backend\":\"gcs\",\"locked\":true},\"providerVersion\":\">= 6.0\",\"destroyApproved\":false,$RES_OK}"

# 4) UNPINNED_PROVIDER — *
run "provider-star" "UNPINNED_PROVIDER" "{\"environment\":\"prod-mnu3ks\",\"state\":{\"backend\":\"gcs\",\"locked\":true},\"providerVersion\":\"*\",\"destroyApproved\":false,$RES_OK}"

# 4) UNPINNED_PROVIDER — latest
run "provider-latest" "UNPINNED_PROVIDER" "{\"environment\":\"prod-mnu3ks\",\"state\":{\"backend\":\"gcs\",\"locked\":true},\"providerVersion\":\"latest\",\"destroyApproved\":false,$RES_OK}"

# 4) valid exact pin
run "provider-exact" "APPROVE" "{\"environment\":\"prod-mnu3ks\",\"state\":{\"backend\":\"gcs\",\"locked\":true},\"providerVersion\":\"6.2.1\",\"destroyApproved\":false,$RES_OK}"

# 4) valid exact pin with =
run "provider-exact-eq" "APPROVE" "{\"environment\":\"prod-mnu3ks\",\"state\":{\"backend\":\"gcs\",\"locked\":true},\"providerVersion\":\"= 6.2.1\",\"destroyApproved\":false,$RES_OK}"

# 5) MISSING_LABELS — wrong cost_center value
run "labels-wrong-value" "MISSING_LABELS" "{$BASE,\"resource\":{\"address\":\"a\",\"type\":\"storage_bucket\",\"action\":\"create\",\"labels\":{\"owner\":\"student-3e7hk\",\"environment\":\"production\",\"cost_center\":\"cc-WRONG\"},\"secret\":null,\"forceDestroy\":false}}"

# 5) MISSING_LABELS — missing owner key entirely
run "labels-missing-key" "MISSING_LABELS" "{$BASE,\"resource\":{\"address\":\"a\",\"type\":\"storage_bucket\",\"action\":\"create\",\"labels\":{\"environment\":\"production\",\"cost_center\":\"cc-1wbe\"},\"secret\":null,\"forceDestroy\":false}}"

# 6) PLAINTEXT_SECRET — raw string
run "secret-plaintext" "PLAINTEXT_SECRET" "{$BASE,\"resource\":{\"address\":\"a\",\"type\":\"sql_database\",\"action\":\"create\",\"labels\":{\"owner\":\"student-3e7hk\",\"environment\":\"production\",\"cost_center\":\"cc-1wbe\"},\"secret\":\"hunter2\",\"forceDestroy\":false}}"

# 6) PLAINTEXT_SECRET — empty secret:// ref
run "secret-empty-ref" "PLAINTEXT_SECRET" "{$BASE,\"resource\":{\"address\":\"a\",\"type\":\"sql_database\",\"action\":\"create\",\"labels\":{\"owner\":\"student-3e7hk\",\"environment\":\"production\",\"cost_center\":\"cc-1wbe\"},\"secret\":\"secret://\",\"forceDestroy\":false}}"

# 6) valid secret ref
run "secret-ref-ok" "APPROVE" "{$BASE,\"resource\":{\"address\":\"a\",\"type\":\"sql_database\",\"action\":\"create\",\"labels\":{\"owner\":\"student-3e7hk\",\"environment\":\"production\",\"cost_center\":\"cc-1wbe\"},\"secret\":\"secret://vault/db-pass\",\"forceDestroy\":false}}"

# 7) DELETE_NOT_APPROVED — storage_bucket delete, not approved
run "delete-not-approved-bucket" "DELETE_NOT_APPROVED" "{\"environment\":\"prod-mnu3ks\",\"state\":{\"backend\":\"gcs\",\"locked\":true},\"providerVersion\":\"~> 6.0\",\"destroyApproved\":false,\"resource\":{\"address\":\"a\",\"type\":\"storage_bucket\",\"action\":\"delete\",\"labels\":{\"owner\":\"student-3e7hk\",\"environment\":\"production\",\"cost_center\":\"cc-1wbe\"},\"secret\":null,\"forceDestroy\":false}}"

# 7) DELETE_NOT_APPROVED — persistent_disk delete, not approved
run "delete-not-approved-disk" "DELETE_NOT_APPROVED" "{\"environment\":\"prod-mnu3ks\",\"state\":{\"backend\":\"s3\",\"locked\":true},\"providerVersion\":\"~> 6.0\",\"destroyApproved\":false,\"resource\":{\"address\":\"a\",\"type\":\"persistent_disk\",\"action\":\"delete\",\"labels\":{\"owner\":\"student-3e7hk\",\"environment\":\"production\",\"cost_center\":\"cc-1wbe\"},\"secret\":null,\"forceDestroy\":false}}"

# 7) delete of a non-guarded type should NOT require approval -> APPROVE
run "delete-unguarded-type" "APPROVE" "{\"environment\":\"prod-mnu3ks\",\"state\":{\"backend\":\"gcs\",\"locked\":true},\"providerVersion\":\"~> 6.0\",\"destroyApproved\":false,\"resource\":{\"address\":\"a\",\"type\":\"compute_instance\",\"action\":\"delete\",\"labels\":{\"owner\":\"student-3e7hk\",\"environment\":\"production\",\"cost_center\":\"cc-1wbe\"},\"secret\":null,\"forceDestroy\":false}}"

# 7) delete approved -> APPROVE
run "delete-approved-bucket" "APPROVE" "{\"environment\":\"prod-mnu3ks\",\"state\":{\"backend\":\"gcs\",\"locked\":true},\"providerVersion\":\"~> 6.0\",\"destroyApproved\":true,\"resource\":{\"address\":\"a\",\"type\":\"storage_bucket\",\"action\":\"delete\",\"labels\":{\"owner\":\"student-3e7hk\",\"environment\":\"production\",\"cost_center\":\"cc-1wbe\"},\"secret\":null,\"forceDestroy\":false}}"

# 8) FORCE_DESTROY — storage_bucket with forceDestroy true (create)
run "force-destroy-create" "FORCE_DESTROY" "{$BASE,\"resource\":{\"address\":\"a\",\"type\":\"storage_bucket\",\"action\":\"create\",\"labels\":{\"owner\":\"student-3e7hk\",\"environment\":\"production\",\"cost_center\":\"cc-1wbe\"},\"secret\":null,\"forceDestroy\":true}}"

# 8) FORCE_DESTROY — approved delete but forceDestroy true (delete-approval passes, then force-destroy check fails)
run "force-destroy-on-approved-delete" "FORCE_DESTROY" "{\"environment\":\"prod-mnu3ks\",\"state\":{\"backend\":\"gcs\",\"locked\":true},\"providerVersion\":\"~> 6.0\",\"destroyApproved\":true,\"resource\":{\"address\":\"a\",\"type\":\"storage_bucket\",\"action\":\"delete\",\"labels\":{\"owner\":\"student-3e7hk\",\"environment\":\"production\",\"cost_center\":\"cc-1wbe\"},\"secret\":null,\"forceDestroy\":true}}"

# baseline valid create
run "create-ok" "APPROVE" "{$BASE,$RES_OK}"

# valid update
run "update-ok" "APPROVE" "{$BASE,\"resource\":{\"address\":\"a\",\"type\":\"storage_bucket\",\"action\":\"update\",\"labels\":{\"owner\":\"student-3e7hk\",\"environment\":\"production\",\"cost_center\":\"cc-1wbe\"},\"secret\":null,\"forceDestroy\":false}}"

# extra unrelated labels present should still pass (only the 3 are required)
run "extra-labels-ok" "APPROVE" "{$BASE,\"resource\":{\"address\":\"a\",\"type\":\"storage_bucket\",\"action\":\"create\",\"labels\":{\"owner\":\"student-3e7hk\",\"environment\":\"production\",\"cost_center\":\"cc-1wbe\",\"team\":\"data-eng\"},\"secret\":null,\"forceDestroy\":false}}"
