"""비밀번호 해싱.

**stdlib 의 `hashlib.scrypt` 를 쓴다.** argon2-cffi 나 bcrypt 를 들이지 않는 이유는 둘 다
네이티브 확장이고, 이 배포는 이미 rspdl 이라는 네이티브 휠 하나에 플랫폼이 묶여 있기
때문이다 (ADR-0004). 휠이 하나 늘면 배포가 깨질 자리가 하나 는다. scrypt 는 RFC 7914 이고
OpenSSL 이 구현을 제공하므로, 여기서 잃는 것은 argon2 대비 약간의 여유뿐이다.

해시는 파라미터를 함께 담아 저장한다:

    scrypt$<n>$<r>$<p>$<salt-b64>$<derived-b64>

파라미터를 코드 상수로만 두면 나중에 값을 올리는 순간 **기존 사용자 전원이 로그인하지
못한다.** 문자열에 들어 있으면 옛 해시는 옛 파라미터로 검증되고, 새 해시만 새 값으로 만들면
된다.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import secrets

# 2**15 · r=8 은 해시 하나에 32MiB 를 쓴다. 로그인 한 번에 수십 ms 가 들지만, 그 비용이
# 곧 유출된 해시를 대량으로 시도하기 어렵게 만드는 값이다.
_N = 2**15
_R = 8
_P = 1
_DKLEN = 32
_SALT_BYTES = 16

# `maxmem` 을 넘기지 않으면 OpenSSL 기본값(32MiB)에 딱 걸려 위 파라미터가 거부된다.
_MAXMEM = 64 * 1024 * 1024


class ScryptPasswordHasher:
    """`PasswordHasherPort` 구현.

    두 메서드 모두 **스레드로 넘긴다.** scrypt 는 일부러 느리게 만든 함수라 이벤트 루프에서
    직접 부르면 그 수십 ms 동안 서버 전체가 멈춘다 — rspdl SDK 를 다루는 규칙과 같다.
    """

    async def hash(self, password: str) -> str:
        return await asyncio.to_thread(_hash, password)

    async def verify(self, *, password: str, hashed: str) -> bool:
        return await asyncio.to_thread(_verify, password, hashed)


def _hash(password: str) -> str:
    salt = secrets.token_bytes(_SALT_BYTES)
    derived = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=_N, r=_R, p=_P, dklen=_DKLEN, maxmem=_MAXMEM
    )
    return "$".join(
        ["scrypt", str(_N), str(_R), str(_P), _b64(salt), _b64(derived)]
    )


def _verify(password: str, hashed: str) -> bool:
    """맞으면 `True`. 저장된 값이 망가져 있어도 예외가 아니라 `False` 다.

    해시 문자열이 잘린 채로 저장되는 일은 없어야 하지만, 그런 날이 오면 로그인 화면이
    500 을 뱉는 것보다 "비밀번호가 맞지 않는다" 로 끝나는 편이 낫다. 어느 쪽이든 그
    사용자는 들어올 수 없고, 500 은 그 위에 장애 알림까지 얹는다.
    """
    try:
        scheme, n, r, p, salt_b64, derived_b64 = hashed.split("$")
        if scheme != "scrypt":
            return False
        salt = _unb64(salt_b64)
        expected = _unb64(derived_b64)
        candidate = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(expected),
            maxmem=_MAXMEM,
        )
    except (ValueError, TypeError):
        return False

    # 비교에 걸린 시간으로 해시를 한 바이트씩 알아내지 못하게 한다.
    return secrets.compare_digest(candidate, expected)


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def _unb64(encoded: str) -> bytes:
    return base64.b64decode(encoded.encode("ascii"), validate=True)
