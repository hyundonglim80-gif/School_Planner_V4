# Firebase Storage에서 파일을 읽어오려면 (CORS 설정)

첨부를 구글 드라이브로 옮기려면, 앱이 먼저 Firebase Storage에서 그 파일을
내려받아야 한다. 그런데 브라우저는 다른 주소의 파일을 함부로 읽지 못하게 막는다.
버킷에 "이 사이트에서 읽어도 된다"고 적어 두어야 풀린다.

적어 두지 않으면 이런 오류가 난다.

    Access to XMLHttpRequest at 'https://firebasestorage.googleapis.com/...'
    from origin 'https://hyundonglim80-gif.github.io' has been blocked by
    CORS policy: No 'Access-Control-Allow-Origin' header is present.

## 한 번만 하면 된다

설치할 것 없이 브라우저에서 할 수 있다.

1. https://console.cloud.google.com/ 에 들어가 오른쪽 위 터미널 아이콘
   (`>_` 모양, Cloud Shell)을 누른다.
2. 아래를 그대로 붙여넣고 실행한다.

```bash
cat > cors.json <<'JSON'
[
  {
    "origin": [
      "https://hyundonglim80-gif.github.io",
      "http://localhost:4190",
      "http://localhost:5173"
    ],
    "method": ["GET"],
    "maxAgeSeconds": 3600,
    "responseHeader": ["Content-Type", "Content-Length", "Content-Disposition"]
  }
]
JSON

gcloud storage buckets update gs://schoolplannerv3.firebasestorage.app --cors-file=cors.json
```

3. 확인:

```bash
gcloud storage buckets describe gs://schoolplannerv3.firebasestorage.app --format="default(cors_config)"
```

그 다음 V4에서 환경설정 → '첨부 파일을 구글 드라이브로 모으기'를 다시 누르면 된다.

## 옮기고 나면

이 설정은 옮기는 동안에만 필요하다. 다 옮긴 뒤에는 되돌려도 된다(되돌리지 않아도
읽기만 허용하는 것이라 큰 문제는 없다). 되돌리려면 `origin`을 빈 배열로 두고 같은
명령을 다시 실행한다.
