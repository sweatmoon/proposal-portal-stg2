/**
 * [ppt-portal 추가 기능 — 첨부PPT 생성 세트의 공용 유틸] PDF의 모든 페이지를 PNG 이미지로
 * 렌더링한다. 국세/지방세 납세증명서, 법인등기부등본처럼 NAS 원본이 pptx가 아니라 PDF인
 * 첨부 항목에서, 그 PDF 페이지들을 "범용 템플릿(도장O)"의 큰 이미지 자리에 페이지 수만큼
 * 복제한 슬라이드에 순서대로 붙여넣기 위해 필요하다(2026-09-03 사용자 확인 — 처음엔 첫
 * 페이지만 썼다가, 2026-09-04 "참고하는 파일이 2페이지 이상이면 모두 넣어야 함" 확인 후
 * 전체 페이지로 확장). 네이티브 빌드 툴 없이 동작하도록 pdfjs-dist(PDF 파싱) +
 * @napi-rs/canvas(사전빌드된 canvas 구현체, DOMMatrix 등 pdfjs가 요구하는 브라우저 전역을
 * 대신 제공)만 쓴다.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DOMMatrix, ImageData, Path2D, createCanvas } from '@napi-rs/canvas'

// pdfjs-dist의 Node용 빌드(legacy)는 브라우저 전역(DOMMatrix/Path2D/ImageData)이 있다고
// 가정하고 동작하므로, import 하기 전에 @napi-rs/canvas가 제공하는 구현체를 전역에 채워준다.
const g = globalThis as unknown as Record<string, unknown>
if (!g.DOMMatrix) g.DOMMatrix = DOMMatrix
if (!g.Path2D) g.Path2D = Path2D
if (!g.ImageData) g.ImageData = ImageData

// pdfjs-dist는 JBIG2/OpenJPEG처럼 스캔 문서에 흔한 압축 방식을 WASM 디코더로 처리하는데,
// wasmUrl을 안 주면 그 바이너리를 못 찾아 "실패한 이미지는 그냥 건너뛴다" — 즉 화면에는
// 에러 없이 그 부분만 빈 채로 나와서 스캔본이 깨져 보인다(2026-09-04 실측 — 법인등기부등본
// pdf가 JBIG2라 텍스트가 통째로 빠짐). node_modules에 같이 설치된 wasm 파일 폴더를 알려줘야
// 하는데, pdfjs의 Node용 로더(NodeBinaryDataFactory)는 이 값을 fs.readFile()에 문자열
// 그대로 붙여서 넘기므로 file:// URL이 아니라 일반 파일시스템 경로(끝에 구분자 포함)여야
// 한다 — file:// URL을 주면 퍼센트 인코딩된 문자열을 그대로 경로로 취급해 못 찾는다.
// pdfjs가 "/"로 끝나는지 문자열로 직접 검사하므로 Windows에서도 구분자는 "/"로 고정한다
// (Node fs는 경로에 섞인 "/"를 그대로 받아들인다).
const wasmUrl = path.dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json'))) + '/wasm/'

export async function pdfAllPagesToPng(pdfBuf: Buffer, scale = 2): Promise<Buffer[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(pdfBuf), wasmUrl })
  try {
    const doc = await loadingTask.promise
    const pages: Buffer[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const viewport = page.getViewport({ scale })
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      // @napi-rs/canvas의 캔버스는 HTMLCanvasElement가 아니지만 pdfjs가 실제로 쓰는
      // getContext('2d') API는 동일하게 구현돼 있어 그대로 넘길 수 있다(타입만 캐스팅 필요).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await page.render({ canvas: canvas as any, viewport } as any).promise
      pages.push(canvas.toBuffer('image/png'))
    }
    return pages
  } finally {
    await loadingTask.destroy()
  }
}
