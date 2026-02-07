# PSD Convert Free (가칭)

PSD 파일을 **업로드 없이(브라우저에서만)** 열어 보고, **PNG/JPG로 변환**해 다운로드하는 웹 앱입니다.

현재 MVP는 “빠름”을 위해 **PSD 내부 composite(병합) 이미지**만 사용합니다.

## 실행

```bash
npm i
npm run dev
```

## 빌드

```bash
npm run build
npm run preview
```

## GitHub Pages 배포
1. 기본 브랜치를 `main`으로 두고, 이 레포에서 GitHub Pages 설정을 `GitHub Actions`로 선택합니다.
2. `main`에 push 하면 `.github/workflows/pages.yml`가 `dist/`를 빌드해서 Pages로 배포합니다.

## 기술 메모
- 파싱/디코딩: `ag-psd`
- 기본 경로: Web Worker(`src/workers/psdComposite.worker.ts`)에서 composite 파싱 후 `ImageBitmap`을 메인으로 전달
- 폴백: `OffscreenCanvas` 미지원 브라우저는 메인 스레드에서 파싱(느릴 수 있음)

## 문서
- 기획서: `docs/PRD.ko.md`
