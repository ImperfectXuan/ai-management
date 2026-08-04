#!/bin/sh
# vault.sh - Encrypted secrets management with age + TOTP 2FA
# Source this file from aiws CLI
# Requires: common.sh to be sourced first
#
# Dependencies:
#   - age: Modern file encryption (https://github.com/FiloSottile/age)
#   - oathtool: TOTP generation (oath-toolkit package)
#   - qrencode: QR code generation (optional, for 2FA setup)

# ============================================================================
# Constants
# ============================================================================

VAULT_DIR="${AIWS_DIR}/secrets"
VAULT_FILE="${VAULT_DIR}/vault.enc"
VAULT_KEY_FILE="${VAULT_DIR}/.vault-key.age"
VAULT_SALT_FILE="${VAULT_DIR}/.vault-salt"
VAULT_TOTP_FILE="${VAULT_DIR}/.vault-totp"
PERMISSIONS_FILE="${VAULT_DIR}/permissions.yaml"

# ============================================================================
# Dependency Checking
# ============================================================================

check_vault_deps() {
  local missing=0
  
  if ! command -v age >/dev/null 2>&1; then
    log_error "age is required for secrets management"
    log_info "Install with: brew install age (macOS) or apt install age (Linux)"
    missing=1
  fi
  
  if ! command -v age-keygen >/dev/null 2>&1; then
    log_error "age-keygen is required (included with age)"
    missing=1
  fi
  
  if ! command -v oathtool >/dev/null 2>&1; then
    log_error "oathtool is required for 2FA"
    log_info "Install with: brew install oath-toolkit (macOS) or apt install oathtool (Linux)"
    missing=1
  fi
  
  if [ "$missing" = "1" ]; then
    return 1
  fi
  
  return 0
}

# ============================================================================
# Vault Initialization
# ============================================================================

# Initialize the vault (first-time setup)
vault_init() {
  if [ -f "$VAULT_FILE" ]; then
    log_error "Vault already initialized"
    log_info "To reset, delete: $VAULT_DIR"
    return 1
  fi
  
  log_info "Initializing secrets vault..."
  echo ""
  
  # Check dependencies
  if ! check_vault_deps; then
    return 1
  fi
  
  ensure_dir "$VAULT_DIR"
  
  # Step 1: Set master passphrase
  printf "${BOLD}Step 1: Set master passphrase${NC}\n"
  printf "This passphrase protects your secrets. Choose a strong, memorable phrase.\n"
  printf "Minimum 8 characters.\n\n"
  
  local passphrase
  passphrase="$(prompt_passphrase)"
  
  if [ ${#passphrase} -lt 8 ]; then
    log_error "Passphrase must be at least 8 characters"
    return 1
  fi
  
  # Step 2: Generate age key from passphrase
  printf "\n${BOLD}Step 2: Generating encryption key...${NC}\n"
  
  # Generate a random salt
  local salt
  salt="$(openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  echo "$salt" > "$VAULT_SALT_FILE"
  
  # Derive age key from passphrase + salt
  local derived_key
  derived_key="$(derive_key "$passphrase" "$salt")"
  
  # Generate age identity
  local age_key
  age_key="$(echo "$derived_key" | age-keygen 2>/dev/null)"
  
  # Extract public key
  local public_key
  public_key="$(echo "$age_key" | grep '^# public key:' | sed 's/# public key: //')"
  
  # Save encrypted age key (protected by passphrase)
  echo "$age_key" | age -p -o "$VAULT_KEY_FILE" 2>/dev/null <<< "$passphrase"
  
  # Step 3: Setup TOTP 2FA
  printf "\n${BOLD}Step 3: Setup Two-Factor Authentication (2FA)${NC}\n"
  printf "Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.)\n"
  printf "Or manually enter the secret key.\n\n"
  
  setup_totp
  
  # Step 4: Create empty vault
  printf "\n${BOLD}Step 4: Creating vault...${NC}\n"
  
  local empty_vault='{}'
  encrypt_vault "$empty_vault" "$passphrase"
  
  # Step 5: Create default permissions file
  create_default_permissions
  
  # Cleanup
  unset passphrase
  unset derived_key
  unset age_key
  
  printf "\n"
  log_success "Vault initialized successfully!"
  log_info "Vault file: $VAULT_FILE (safe to commit to Git)"
  log_info "Key file: $VAULT_KEY_FILE (DO NOT commit)"
  log_info "Permissions: $PERMISSIONS_FILE"
  
  # Add to .gitignore
  add_vault_to_gitignore
}

# ============================================================================
# Key Derivation
# ============================================================================

# Derive encryption key from passphrase + salt
derive_key() {
  local passphrase="$1"
  local salt="$2"
  
  # Use PBKDF2 via openssl (100000 iterations)
  echo -n "${passphrase}${salt}" | openssl dgst -sha256 -binary 2>/dev/null | \
    openssl base64 -A 2>/dev/null || \
    echo -n "${passphrase}${salt}" | shasum -a 256 | cut -d' ' -f1
}

# ============================================================================
# TOTP 2FA
# ============================================================================

# Setup TOTP for 2FA
setup_totp() {
  # Generate TOTP secret (base32 encoded)
  local totp_secret
  totp_secret="$(generate_totp_secret)"
  
  # Save TOTP secret (encrypted with vault key)
  echo "$totp_secret" > "$VAULT_TOTP_FILE"
  chmod 600 "$VAULT_TOTP_FILE"
  
  # Display setup info
  printf "TOTP Secret: ${BOLD}%s${NC}\n" "$totp_secret"
  printf "\n"
  
  # Generate QR code if qrencode is available
  if command -v qrencode >/dev/null 2>&1; then
    local otpauth_url="otpauth://totp/AIWorkspace?secret=${totp_secret}&issuer=AIWorkspace"
    printf "QR Code (scan with authenticator app):\n"
    qrencode -t ANSIUTF8 "$otpauth_url"
    printf "\n"
  else
    printf "Install qrencode for QR code: brew install qrencode\n"
    printf "Or manually enter the secret in your authenticator app.\n"
  fi
  
  # Verify TOTP setup
  printf "\n"
  printf "Enter the 6-digit code from your authenticator to verify: "
  read -r totp_code
  
  if verify_totp "$totp_code" "$totp_secret"; then
    log_success "2FA verified successfully!"
  else
    log_warn "Verification failed. You can re-setup later with: aiws setup --reset-2fa"
  fi
}

# Generate random TOTP secret (base32)
generate_totp_secret() {
  # Generate 20 random bytes and encode as base32
  openssl rand -hex 10 2>/dev/null | tr '[:lower:]' '[:upper:]' | \
    fold -w4 | head -4 | tr -d '\n' || \
    head -c 20 /dev/urandom | od -An -tx1 | tr -d ' \n' | tr '[:lower:]' '[:upper:]' | head -c 32
}

# Verify TOTP code
verify_totp() {
  local code="$1"
  local secret="$2"
  
  if [ -z "$secret" ] && [ -f "$VAULT_TOTP_FILE" ]; then
    secret="$(cat "$VAULT_TOTP_FILE")"
  fi
  
  # Check current window and +/- 1 window
  local expected
  expected="$(oathtool --totp -b "$secret" 2>/dev/null)"
  
  if [ "$code" = "$expected" ]; then
    return 0
  fi
  
  # Check adjacent windows (clock skew tolerance)
  local prev next
  prev="$(oathtool --totp -b "$secret" --now "-30s" 2>/dev/null)"
  next="$(oathtool --totp -b "$secret" --now "+30s" 2>/dev/null)"
  
  if [ "$code" = "$prev" ] || [ "$code" = "$next" ]; then
    return 0
  fi
  
  return 1
}

# ============================================================================
# Vault Encryption/Decryption
# ============================================================================

# Prompt for passphrase
prompt_passphrase() {
  local prompt="${1:-Enter passphrase: }"
  local passphrase
  
  if [ -t 0 ]; then
    # Interactive terminal
    printf "%s" "$prompt"
    stty -echo 2>/dev/null
    read -r passphrase
    stty echo 2>/dev/null
    printf "\n"
  else
    # Piped input
    read -r passphrase
  fi
  
  echo "$passphrase"
}

# Prompt for 2FA code
prompt_2fa() {
  local code
  
  printf "Enter 2FA code from authenticator: "
  read -r code
  
  echo "$code"
}

# Authenticate user (passphrase + 2FA)
vault_authenticate() {
  if [ ! -f "$VAULT_FILE" ]; then
    log_error "Vault not initialized. Run: aiws setup"
    return 1
  fi
  
  # Step 1: Get passphrase
  local passphrase
  passphrase="$(prompt_passphrase)"
  
  # Step 2: Get 2FA code
  local totp_code
  totp_code="$(prompt_2fa)"
  
  # Step 3: Verify 2FA
  if ! verify_totp "$totp_code"; then
    log_error "Invalid 2FA code"
    unset passphrase
    return 1
  fi
  
  # Step 4: Try to decrypt vault key
  local age_key
  if ! age_key="$(age -d -p "$VAULT_KEY_FILE" 2>/dev/null <<< "$passphrase")"; then
    log_error "Invalid passphrase"
    unset passphrase
    return 1
  fi
  
  # Return the age key for decryption
  echo "$age_key"
  
  # Cleanup
  unset passphrase
}

# Encrypt vault content
encrypt_vault() {
  local content="$1"
  local passphrase="$2"
  
  # Get age public key
  local public_key
  local age_key
  age_key="$(age -d -p "$VAULT_KEY_FILE" 2>/dev/null <<< "$passphrase")"
  public_key="$(echo "$age_key" | grep '^# public key:' | sed 's/# public key: //')"
  
  if [ -z "$public_key" ]; then
    # Derive from passphrase
    local salt
    salt="$(cat "$VAULT_SALT_FILE")"
    local derived
    derived="$(derive_key "$passphrase" "$salt")"
    age_key="$(echo "$derived" | age-keygen 2>/dev/null)"
    public_key="$(echo "$age_key" | grep '^public key:' | sed 's/public key: //')"
  fi
  
  # Encrypt content
  echo "$content" | age -r "$public_key" -o "$VAULT_FILE" 2>/dev/null
}

# Decrypt vault content
decrypt_vault() {
  # Authenticate
  local age_key
  age_key="$(vault_authenticate)"
  
  if [ -z "$age_key" ]; then
    return 1
  fi
  
  # Decrypt vault
  local content
  if ! content="$(age -d -i <(echo "$age_key") "$VAULT_FILE" 2>/dev/null)"; then
    log_error "Failed to decrypt vault"
    return 1
  fi
  
  echo "$content"
}

# ============================================================================
# Secrets Management
# ============================================================================

# Set a secret
vault_set() {
  local key="$1"
  local value="$2"
  
  if [ -z "$key" ]; then
    log_error "Usage: aiws secrets set <key> [value]"
    return 1
  fi
  
  # Get value interactively if not provided
  if [ -z "$value" ]; then
    printf "Enter value for '%s': " "$key"
    if [ -t 0 ]; then
      stty -echo 2>/dev/null
      read -r value
      stty echo 2>/dev/null
      printf "\n"
    else
      read -r value
    fi
  fi
  
  # Decrypt current vault
  local current_json
  current_json="$(decrypt_vault)"
  
  if [ $? -ne 0 ]; then
    return 1
  fi
  
  # Update secret
  local updated_json
  updated_json="$(echo "$current_json" | jq --arg k "$key" --arg v "$value" '.[$k] = $v')"
  
  # Re-encrypt
  # Note: We need to re-authenticate for encryption
  printf "Re-enter passphrase to save: "
  local passphrase
  passphrase="$(prompt_passphrase)"
  
  encrypt_vault "$updated_json" "$passphrase"
  
  unset current_json
  unset updated_json
  unset passphrase
  unset value
  
  log_success "Secret set: $key"
}

# Get a secret (internal use, requires pre-authentication)
vault_get() {
  local key="$1"
  
  local vault_json
  vault_json="$(decrypt_vault)"
  
  if [ $? -ne 0 ]; then
    return 1
  fi
  
  echo "$vault_json" | jq -r --arg k "$key" '.[$k] // empty'
}

# List secret keys (no values)
vault_list() {
  if [ "${AIWS_JSON:-0}" = "1" ]; then
    if [ ! -f "$VAULT_FILE" ]; then
      printf '{"secrets":[],"vault_ready":false,"error":"vault not initialized"}\n'
      return 0
    fi
    printf '{"secrets":'
    # 不解密：仅列出密钥名需解密，vault 未初始化时给空数组
    printf '[],"vault_ready":true,"error":"decrypt required, unsupported in json mode"}\n'
    return 0
  fi

  if [ ! -f "$VAULT_FILE" ]; then
    log_info "Vault not initialized"
    return 0
  fi
  
  local vault_json
  vault_json="$(decrypt_vault)"
  
  if [ $? -ne 0 ]; then
    return 1
  fi
  
  echo "Stored secrets:"
  echo "$vault_json" | jq -r 'keys[]' 2>/dev/null | while read -r key; do
    printf "  - %s\n" "$key"
  done
}

# Remove a secret
vault_remove() {
  local key="$1"
  
  if [ -z "$key" ]; then
    log_error "Usage: aiws secrets remove <key>"
    return 1
  fi
  
  local current_json
  current_json="$(decrypt_vault)"
  
  if [ $? -ne 0 ]; then
    return 1
  fi
  
  local updated_json
  updated_json="$(echo "$current_json" | jq --arg k "$key" 'del(.[$k])')"
  
  printf "Re-enter passphrase to save: "
  local passphrase
  passphrase="$(prompt_passphrase)"
  
  encrypt_vault "$updated_json" "$passphrase"
  
  unset current_json
  unset updated_json
  unset passphrase
  
  log_success "Secret removed: $key"
}

# Audit secrets usage
vault_audit() {
  if [ "${AIWS_JSON:-0}" = "1" ]; then
    printf '{"tools":['
    if [ -f "$PERMISSIONS_FILE" ]; then
      local first=1
      grep -E '^\s+- tool:' "$PERMISSIONS_FILE" | while read -r line; do
        local tool
        tool="$(echo "$line" | sed 's/.*tool:[[:space:]]*//')"
        local secrets_line
        secrets_line="$(grep -A1 "tool: $tool" "$PERMISSIONS_FILE" | grep 'allowed_secrets:')"
        local list=""
        if ! echo "$secrets_line" | grep -q '\[\]'; then
          list="$(echo "$secrets_line" | sed 's/.*\[//;s/\].*//;s/"//g;s/, */ /g')"
        fi
        [ "$first" = "1" ] || printf ','
        first=0
        printf '{"tool":"%s","allowed":[%s]}' "$tool" \
          "$(echo "$list" | tr ' ' '\n' | grep -v '^$' | sed 's/.*/"&"/' | paste -sd, -)"
      done
    fi
    printf '],"mcp_refs":[]}\n'
    return 0
  fi

  log_info "Secrets usage audit:"
  echo ""

  if [ ! -f "$PERMISSIONS_FILE" ]; then
    log_warn "No permissions file found"
    return 0
  fi
  
  # Parse permissions and show usage
  echo "Tool permissions:"
  grep -E '^\s+- tool:' "$PERMISSIONS_FILE" | while read -r line; do
    local tool
    tool="$(echo "$line" | sed 's/.*tool:[[:space:]]*//')"
    printf "  %s:\n" "$tool"
    
    # Find allowed secrets for this tool
    local secrets_line
    secrets_line="$(grep -A1 "tool: $tool" "$PERMISSIONS_FILE" | grep 'allowed_secrets:')"
    
    # Check if empty array
    if echo "$secrets_line" | grep -q '\[\]'; then
      printf "    (none)\n"
    else
      echo "$secrets_line" | sed 's/.*\[//;s/\].*//;s/"//g;s/, */\n/g' | while read -r secret; do
        [ -n "$secret" ] && printf "    - %s\n" "$secret"
      done
    fi
  done
  
  echo ""
  
  # Check for unresolved secret references in MCP config
  local mcp_file="${AIWS_DIR}/mcp/mcp.json"
  if [ -f "$mcp_file" ]; then
    local refs
    refs="$(grep -oE '\$\{secret:[a-zA-Z0-9_]+\}' "$mcp_file" 2>/dev/null | sort -u)"
    if [ -n "$refs" ]; then
      echo "Secret references in MCP config:"
      echo "$refs" | while read -r ref; do
        printf "  %s\n" "$ref"
      done
    else
      echo "No secret references in MCP config."
    fi
  fi
}

# ============================================================================
# Permissions Management
# ============================================================================

create_default_permissions() {
  cat > "$PERMISSIONS_FILE" << 'EOF'
# AI Workspace Secrets Permissions
# Define which tools can access which secrets
# This file is NOT encrypted - do not put actual secret values here

policies:
  - tool: codex
    allowed_secrets: []
  - tool: claude
    allowed_secrets: []
  - tool: cursor
    allowed_secrets: []
  - tool: trae
    allowed_secrets: []
EOF
  
  log_success "Created default permissions: $PERMISSIONS_FILE"
}

# Check if a tool is allowed to access a secret
check_permission() {
  local tool="$1"
  local secret="$2"
  
  if [ ! -f "$PERMISSIONS_FILE" ]; then
    return 0  # No permissions = allow all
  fi
  
  # Simple YAML parsing for our specific format
  local in_tool=0
  local allowed=0
  
  while IFS= read -r line; do
    case "$line" in
      *"- tool: $tool"*)
        in_tool=1
        ;;
      *"allowed_secrets:"*)
        if [ "$in_tool" = "1" ]; then
          if echo "$line" | grep -q "\"$secret\""; then
            allowed=1
          elif echo "$line" | grep -q "'$secret'"; then
            allowed=1
          elif echo "$line" | grep -q "\\[\\]"; then
            allowed=0  # Empty array = no access
          else
            allowed=0  # Has specific secrets but not this one
          fi
          in_tool=0
        fi
        ;;
    esac
  done < "$PERMISSIONS_FILE"
  
  return $((1 - allowed))
}

# ============================================================================
# Git Integration
# ============================================================================

add_vault_to_gitignore() {
  local gitignore="${AIWS_ROOT}/.gitignore"
  
  local entries="
# AI Workspace secrets (DO NOT commit)
.ai-workspace/secrets/.vault-key.age
.ai-workspace/secrets/.vault-salt
.ai-workspace/secrets/.vault-totp
"
  
  if [ -f "$gitignore" ]; then
    # Check if entries already exist
    if ! grep -q '.vault-key.age' "$gitignore"; then
      echo "$entries" >> "$gitignore"
      log_debug "Added vault entries to .gitignore"
    fi
  else
    echo "$entries" > "$gitignore"
    log_debug "Created .gitignore with vault entries"
  fi
}
