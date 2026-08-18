#!/usr/bin/env bash
#
# Parameter Store 에 시크릿 값을 넣는다.
#
#   cp deploy/lightsail/secrets.example.env deploy/lightsail/secrets.env
#   $EDITOR deploy/lightsail/secrets.env
#   ./deploy/lightsail/put-secrets.sh
#
# 값은 절대 argv 로 넘기지 않는다. `--value` 를 쓰면 `ps` 에 보이고 셸 히스토리에도
# 남는다. 대신 600 권한 임시 파일을 거친다. 화면에도 값을 찍지 않는다 — 키 이름과
# 길이만 보여준다.
#
# 아직 값이 없는 파라미터가 있으면, 그 값을 어디서 얻는지 마지막에 안내한다.
#
# 옵션:
#   --file <경로>     기본값 deploy/lightsail/secrets.env
#   --profile <이름>  AWS 프로필. 생략하면 AWS_PROFILE 환경변수, 그것도 없고
#                     프로필이 딱 하나면 그것을 쓴다
#   --dry-run         무엇을 올릴지만 보여주고 실제로 올리지 않는다
#   --no-sync         업로드 후 인스턴스 동기화를 건너뛴다

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SECRETS_FILE="$REPO_ROOT/deploy/lightsail/secrets.env"
SSM_PREFIX="${DAHAZE_SSM_PREFIX:-/dahaze/prod}"
REGION="${AWS_REGION:-ap-northeast-2}"
DRY_RUN=0
SYNC=1

while [ $# -gt 0 ]; do
  case "$1" in
    --file) SECRETS_FILE="$2"; shift 2 ;;
    --profile) AWS_PROFILE="$2"; export AWS_PROFILE; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --no-sync) SYNC=0; shift ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "알 수 없는 옵션: $1" >&2; exit 2 ;;
  esac
done

log() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

# 프로필을 정한다. 명시하지 않았는데 프로필이 딱 하나면 그것을 쓴다 — 매번 AWS_PROFILE 을
# 앞에 붙이게 하면 언젠가 빠뜨리고, 그러면 엉뚱한 계정에 올라간다.
if [ -z "${AWS_PROFILE:-}" ]; then
  PROFILES=$(aws configure list-profiles 2>/dev/null || true)
  COUNT=$(printf '%s\n' "$PROFILES" | grep -c . || true)
  if [ "$COUNT" = "1" ]; then
    AWS_PROFILE="$PROFILES"; export AWS_PROFILE
  elif [ "$COUNT" -gt 1 ] 2>/dev/null; then
    echo "✗ AWS 프로필이 여러 개다. --profile 로 하나를 고를 것:" >&2
    printf '%s\n' "$PROFILES" | sed 's/^/    /' >&2
    exit 2
  fi
fi

# 어느 계정에 올리는지 먼저 보여준다. 잘못된 계정에 시크릿을 올리는 것은 되돌릴 수 없다.
ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || true)
if [ -z "$ACCOUNT" ]; then
  echo "✗ AWS 자격증명을 확인할 수 없다 (프로필: ${AWS_PROFILE:-기본})." >&2
  exit 1
fi
echo "AWS 계정 $ACCOUNT / 프로필 ${AWS_PROFILE:-기본} / 리전 $REGION / 경로 $SSM_PREFIX"

# 어느 파라미터가 SecureString 인지는 Terraform 이 이미 정했다. 여기서 다시 정하면
# 두 곳이 갈라지므로, 실제 타입을 SSM 에 물어본다.
declare -A EXISTING_TYPE

if [ ! -f "$SECRETS_FILE" ]; then
  echo "✗ $SECRETS_FILE 가 없다." >&2
  echo >&2
  echo "  cp deploy/lightsail/secrets.example.env deploy/lightsail/secrets.env" >&2
  echo "  \$EDITOR deploy/lightsail/secrets.env" >&2
  exit 1
fi

# 남이 읽을 수 있는 권한이면 알려준다. 시크릿이 든 파일이다.
PERM=$(stat -c '%a' "$SECRETS_FILE" 2>/dev/null || stat -f '%Lp' "$SECRETS_FILE")
case "$PERM" in
  600|400) ;;
  *) echo "⚠ $SECRETS_FILE 권한이 $PERM 이다. chmod 600 을 권한다." >&2 ;;
esac

log "현재 파라미터 확인"
while IFS=$'\t' read -r name type; do
  EXISTING_TYPE["${name##*/}"]="$type"
done < <(aws ssm get-parameters-by-path --region "$REGION" --path "$SSM_PREFIX" \
           --recursive --query 'Parameters[].[Name,Type]' --output text)
echo "  $SSM_PREFIX 아래 ${#EXISTING_TYPE[@]} 개"

# --- 검증 -------------------------------------------------------------------
#
# 올리기 전에 전부 검사한다. 절반만 올라간 상태가 가장 나쁘다 — 배포는 통과하는데
# 일부 값만 옛것이라 원인을 찾기 어렵다.

# 사람이 자연스럽게 쓰는 다른 이름을 표준 이름으로 옮긴다. 조용히 추측하지 않고
# 옮겼다는 사실을 화면에 남긴다.
declare -A ALIAS=(
  [GITHUB_OAUTH_CLIENT_ID]=GITHUB_CLIENT_ID
  [GITHUB_OAUTH_CLIENT_SECRET]=GITHUB_CLIENT_SECRET
  [OPENAI_KEY]=OPENAI_API_KEY
)

declare -a KEYS=() VALUES=()
PROBLEMS=0
LINE_NO=0

while IFS= read -r line || [ -n "$line" ]; do
  LINE_NO=$((LINE_NO + 1))
  case "$line" in
    ''|'#'*) continue ;;
  esac
  if [[ "$line" != *=* ]]; then
    echo "✗ ${LINE_NO}행: KEY=값 형식이 아니다" >&2
    PROBLEMS=$((PROBLEMS + 1)); continue
  fi

  key="${line%%=*}"
  value="${line#*=}"

  if [ -n "${ALIAS[$key]:=}" ] && [ -z "${EXISTING_TYPE[$key]:-}" ]; then
    echo "· $key → ${ALIAS[$key]} 로 옮긴다"
    key="${ALIAS[$key]}"
  fi

  if [ -z "$value" ]; then
    echo "· $key — 비어 있어 건너뛴다"
    continue
  fi
  if [ -z "${EXISTING_TYPE[$key]:-}" ]; then
    echo "✗ $key — $SSM_PREFIX 아래에 없는 파라미터다" >&2
    # 오타일 가능성이 높으므로 비슷한 이름을 보여준다. 그냥 "없다"만 하면
    # Terraform 을 열어 이름을 대조해야 한다.
    NEAR=$(printf '%s\n' "${!EXISTING_TYPE[@]}" | grep -iF "$(echo "$key" | cut -d_ -f1)" || true)
    [ -n "$NEAR" ] && printf '  비슷한 이름: %s\n' "$(echo "$NEAR" | tr '\n' ' ')" >&2
    PROBLEMS=$((PROBLEMS + 1)); continue
  fi
  # 따옴표를 두른 채 붙여 넣는 실수가 잦다. 값에 따옴표가 그대로 저장되면
  # OAuth 가 조용히 실패하고 원인이 보이지 않는다.
  case "$value" in
    \"*\"|\'*\'*) echo "✗ $key — 값이 따옴표로 감싸여 있다. 따옴표 없이 쓸 것" >&2
                  PROBLEMS=$((PROBLEMS + 1)); continue ;;
  esac
  if [ "$value" = "placeholder" ]; then
    echo "✗ $key — 값이 그대로 'placeholder' 다" >&2
    PROBLEMS=$((PROBLEMS + 1)); continue
  fi

  KEYS+=("$key"); VALUES+=("$value")
  printf '  %-22s %s자 (%s)\n' "$key" "${#value}" "${EXISTING_TYPE[$key]}"
done < "$SECRETS_FILE"

if [ "$PROBLEMS" -gt 0 ]; then
  echo >&2; echo "문제 ${PROBLEMS}건. 아무것도 올리지 않았다." >&2
  exit 1
fi
if [ "${#KEYS[@]}" -eq 0 ]; then
  echo; echo "올릴 값이 없다. $SECRETS_FILE 를 채웠는지 확인할 것."; exit 1
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo; echo "--dry-run 이라 여기서 멈춘다."; exit 0
fi

# --- 업로드 -----------------------------------------------------------------

log "업로드"
for i in "${!KEYS[@]}"; do
  key="${KEYS[$i]}"; value="${VALUES[$i]}"; type="${EXISTING_TYPE[$key]}"

  # 값을 argv 로 넘기지 않는다 — `--value` 를 쓰면 `ps` 에 보인다.
  #
  # `file:///dev/stdin` 은 쓸 수 없다. AWS CLI 가 그 파일을 seek 하는데 파이프는 seek 이
  # 안 되어 "Invalid JSON received" 로 죽는다. 그래서 600 권한 임시 파일을 거친다.
  # 시크릿 파일이 이미 디스크에 있으므로 노출 범위가 새로 늘지는 않는다.
  REQ=$(mktemp); chmod 600 "$REQ"
  VALUE="$value" NAME="$SSM_PREFIX/$key" TYPE="$type" python3 -c '
import json, os, sys
json.dump({"Name": os.environ["NAME"], "Value": os.environ["VALUE"],
           "Type": os.environ["TYPE"], "Overwrite": True}, sys.stdout)
' > "$REQ"

  if aws ssm put-parameter --region "$REGION" --cli-input-json "file://$REQ" >/dev/null; then
    shred -u "$REQ" 2>/dev/null || rm -f "$REQ"
    echo "  ✓ $key"
  else
    shred -u "$REQ" 2>/dev/null || rm -f "$REQ"
    echo "  ✗ $key 업로드 실패" >&2
    exit 1
  fi
done

# --- 검증 -------------------------------------------------------------------

log "남은 placeholder 확인"
REMAINING=$(aws ssm get-parameters-by-path --region "$REGION" --path "$SSM_PREFIX" \
  --recursive --with-decryption \
  --query 'Parameters[?Value==`placeholder`].Name' --output text)
if [ -n "$REMAINING" ]; then
  echo "$REMAINING" | tr '\t' '\n' | sed "s|$SSM_PREFIX/|  · |"
  echo
  echo "위 값들이 남아 있으면 배포가 멈춘다 (dahaze-env-sync 가 거부한다)."

  # 값을 어디서 얻는지 여기서 알려준다. 필요한 순간에 화면에 뜨는 편이 문서보다 낫다.
  case "$REMAINING" in
    *GITHUB_CLIENT*)
      # 콜백 URL 은 저장된 OAUTH_REDIRECT_URI 를 그대로 보여준다. 손으로 옮겨 적으면
      # 한 글자 어긋나고, GitHub 은 redirect_uri_mismatch 로만 알려준다.
      CALLBACK=$(aws ssm get-parameter --region "$REGION" \
        --name "$SSM_PREFIX/OAUTH_REDIRECT_URI" --query 'Parameter.Value' --output text)
      HOMEPAGE=$(aws ssm get-parameter --region "$REGION" \
        --name "$SSM_PREFIX/WEB_POST_LOGIN_URL" --query 'Parameter.Value' --output text)
      cat <<EOF

  GitHub OAuth App 만들기 — https://github.com/settings/developers → New OAuth App

    Application name             dahaze (production)
    Homepage URL                 $HOMEPAGE
    Authorization callback URL   $CALLBACK

  콜백 URL 은 위 문자열과 **정확히** 같아야 한다. 다르면 GitHub 이 로그인 시점에
  redirect_uri_mismatch 로만 거부하고, 무엇이 다른지는 알려주지 않는다.
  Client secret 은 생성 직후 한 번만 보인다.
EOF
      ;;
  esac
  case "$REMAINING" in
    *OPENAI_API_KEY*)
      echo
      echo "  OPENAI_API_KEY — https://platform.openai.com/api-keys"
      echo "  비워 두면 /api/authoring/* 만 503 이 되고 나머지 API 는 정상 동작한다."
      ;;
  esac
else
  echo "  없음 — 모든 파라미터에 실제 값이 있다"
fi

# --- 인스턴스 동기화 ---------------------------------------------------------

if [ "$SYNC" -eq 1 ] && [ -z "$REMAINING" ]; then
  INSTANCE=$(aws ssm describe-instance-information --region "$REGION" \
    --query "InstanceInformationList[?starts_with(InstanceId,'mi-')]|[0].InstanceId" \
    --output text 2>/dev/null || true)

  if [ -n "$INSTANCE" ] && [ "$INSTANCE" != "None" ]; then
    log "인스턴스에 반영 ($INSTANCE)"
    CMD=$(aws ssm send-command --region "$REGION" --instance-ids "$INSTANCE" \
      --document-name AWS-RunShellScript --comment "dahaze env sync" \
      --parameters 'commands=["sudo /usr/local/bin/dahaze-env-sync"]' \
      --query 'Command.CommandId' --output text)
    for _ in $(seq 1 20); do
      STATUS=$(aws ssm get-command-invocation --region "$REGION" --command-id "$CMD" \
        --instance-id "$INSTANCE" --query Status --output text 2>/dev/null || echo Pending)
      case "$STATUS" in Success|Failed|TimedOut|Cancelled) break ;; esac
      sleep 3
    done
    # 출력에는 키 개수만 나온다. dahaze-env-sync 는 값을 찍지 않는다.
    aws ssm get-command-invocation --region "$REGION" --command-id "$CMD" \
      --instance-id "$INSTANCE" --query StandardOutputContent --output text | sed 's/^/  /'
    [ "$STATUS" = "Success" ] || {
      aws ssm get-command-invocation --region "$REGION" --command-id "$CMD" \
        --instance-id "$INSTANCE" --query StandardErrorContent --output text >&2
      exit 1
    }
  else
    echo; echo "SSM 관리형 인스턴스를 찾지 못해 동기화를 건너뛴다."
  fi
fi

# --- 뒷정리 -----------------------------------------------------------------

echo
if [ -t 0 ]; then
  printf '%s 를 지울까? [y/N] ' "$SECRETS_FILE"
  read -r answer
  case "$answer" in
    y|Y) shred -u "$SECRETS_FILE" 2>/dev/null || rm -f "$SECRETS_FILE"
         echo "지웠다." ;;
    *) echo "남겨 둔다. .gitignore 대상이지만 다 쓰면 지우는 편이 낫다." ;;
  esac
else
  echo "$SECRETS_FILE 를 남겨 뒀다. 다 썼으면 지울 것."
fi

printf '\n\033[32m완료\033[0m\n'
