/**
 * VAPID 키 쌍 생성 — 의존성 없이 Node 기본 crypto만 쓴다.
 *
 * VAPID는 P-256 ECDSA 키 쌍이고, 웹 푸시 규격은 base64url 인코딩을 요구한다.
 * 공개키는 uncompressed point(0x04 || X || Y) 65바이트다.
 */
import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// JWK로 뽑으면 x·y·d가 이미 base64url이다. 직접 DER을 파싱할 이유가 없다.
const pubJwk = publicKey.export({ format: 'jwk' });
const privJwk = privateKey.export({ format: 'jwk' });

const fromB64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

const x = fromB64url(pubJwk.x);
const y = fromB64url(pubJwk.y);
if (x.length !== 32 || y.length !== 32) {
  console.error('키 길이가 이상해요. 다시 실행해주세요.');
  process.exit(1);
}

const publicApplicationServerKey = b64url(Buffer.concat([Buffer.from([0x04]), x, y]));
const privateApplicationServerKey = privJwk.d;

console.log(`
VAPID 키를 만들었어요. 공개키는 클라이언트, 개인키는 서버에만 둡니다.

app/.env
  VITE_VAPID_PUBLIC_KEY=${publicApplicationServerKey}

supabase/functions/.env  (그 뒤 supabase secrets set --env-file supabase/functions/.env)
  VAPID_PUBLIC_KEY=${publicApplicationServerKey}
  VAPID_PRIVATE_KEY=${privateApplicationServerKey}
  VAPID_SUBJECT=mailto:본인이메일

개인키는 저장소에 커밋하지 마세요 — .gitignore가 .env를 막고 있습니다.
`);
