#!/usr/bin/env bash
#
# RSPDL 이 설치될 수 있는 플랫폼인지 확인한다.
#
# RSPDL 은 다음 넷만 배포한다 (0.1.0 기준):
#   macosx_14_0_arm64 · macosx_14_0_x86_64 · manylinux_2_28_x86_64 · win_amd64
#
# linux aarch64 wheel 이 없고 **sdist 도 없다.** 따라서 Linux arm64 에서는 소스 빌드로
# fallback 하지도 못하고 설치가 그냥 실패한다. musl(Alpine) 도 마찬가지다.
#
# 이 검사는 CI 와 배포 파이프라인 앞단에서 돈다. 잘못된 아키텍처의 이미지를 빌드하는 데
# 시간을 쓰기 전에 여기서 멈추기 위해서다 (ADR-0002, ADR-0004).

set -euo pipefail

OS=$(uname -s)
ARCH=$(uname -m)

fail() {
  echo "✗ RSPDL 을 설치할 수 없는 플랫폼: $OS/$ARCH" >&2
  echo >&2
  echo "  $1" >&2
  echo >&2
  echo "  근거: docs/adr/0002-rspdl-compiler-integration.md" >&2
  exit 1
}

case "$OS" in
  Linux)
    if [ "$ARCH" != "x86_64" ]; then
      fail "RSPDL 은 linux aarch64 wheel 을 배포하지 않고 sdist 도 없다.
  x86_64 인스턴스를 쓸 것 (AWS Graviton/t4g 계열 불가)."
    fi
    # glibc 확인. musl 환경에는 manylinux wheel 이 설치되지 않는다.
    # `ldd --version | head` 는 SIGPIPE 로 pipefail 을 건드리므로 쓰지 않는다.
    LIBC=$(getconf GNU_LIBC_VERSION 2>/dev/null || true)
    if [ -z "$LIBC" ]; then
      LIBC=$(ldd --version 2>&1 | grep -im1 glibc || true)
    fi
    if [ -z "$LIBC" ]; then
      fail "manylinux_2_28 wheel 은 glibc 를 요구한다. Alpine/musl 베이스는 쓸 수 없다."
    fi
    ;;
  Darwin)
    # macOS 는 arm64·x86_64 wheel 이 모두 있다. deployment target 은 14.0 이상.
    ;;
  *)
    echo "⚠ 확인되지 않은 플랫폼: $OS/$ARCH — 설치가 실패할 수 있다" >&2
    ;;
esac

echo "✓ 플랫폼 $OS/$ARCH — RSPDL wheel 사용 가능"
