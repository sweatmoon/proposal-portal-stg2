/**
 * ppt-engine.js
 * ──────────────────────────────────────────────────────────────
 * PPT 자동화 고도화 엔진
 *
 * 구조:
 *   ProjectViewModel  — 데이터 표준화 (HTML Parser / DB Loader 양쪽 추상화)
 *   PptMenuRegistry   — DB에서 로드한 메뉴/규칙 캐시
 *   generateMenuPpt() — 단일 메뉴 PPT 생성 (메뉴 코드 → {zip, slideCount})
 *   generateProposalPpt() — 전체 메뉴 순서대로 생성 후 합본
 *   mergePresentationZips() — 범용 PPTX 합본 (STANDARD + FOREIGN_TEMPLATE)
 *
 * 기존 Generator 함수들은 그대로 유지하면서
 * 이 모듈이 메뉴 디스패처 역할을 담당한다.
 * ──────────────────────────────────────────────────────────────
 */

'use strict';

// ═══════════════════════════════════════════════════════════════
// 1. ProjectViewModel — 표준 데이터 구조
//    parsedData (HTML 파서 산출물)를 ViewModel로 변환
// ═══════════════════════════════════════════════════════════════

/**
 * parsedData → ProjectViewModel 변환
 * 기존 parsedData 구조를 그대로 활용하면서 표준 인터페이스를 제공
 *
 * @param {object} pd - parsedData (기존 HTML 파서 결과)
 * @returns {object} ProjectViewModel
 */
function buildProjectViewModel(pd) {
  if (!pd) return null;

  // 인력을 역할별로 분류
  const allMembers = (pd.portalOrder || []).map(({ name }) => {
    const info = pd.personGradeMap?.[name] || {};
    const field = pd.personFieldMap?.[name] || '';
    const group = info.group || '';
    return { name, field, grade: info.grade || '', group, residency: info.residency || '', certNo: info.certNo || '' };
  });

  const auditMembers   = allMembers.filter(m => !m.group || m.group === '감리원');
  const coreExperts    = allMembers.filter(m => m.group === '핵심기술');
  const requiredExperts = allMembers.filter(m => m.group === '필수기술');
  const securityExperts = allMembers.filter(m => m.group === '보안');
  const testers        = allMembers.filter(m => m.group === '테스터');

  return {
    // ── 프로젝트 기본 정보
    project: {
      title: pd.projectTitle || '',
      client: pd.clientOrg || '',
      period: pd.projectPeriod || '',
      budget: pd.budget || '',
    },
    // ── 감리 단계 (stages) — 기존 구조 그대로
    stages: pd.stages || [],
    // ── 전체 인력 (순서 포함)
    members: allMembers,
    portalOrder: pd.portalOrder || [],
    // ── 역할별 분류
    auditMembers,
    coreExperts,
    requiredExperts,
    securityExperts,
    testers,
    // ── 원시 맵 (기존 함수 호환용)
    personGradeMap: pd.personGradeMap || {},
    personFieldMap: pd.personFieldMap || {},
    // ── 요구사항 / 리스크 (향후 확장)
    requirements: pd.requirements || [],
    risks: pd.risks || [],
    keywords: pd.keywords || [],
    // ── 요약 (computeSummaryTableData 등 결과 캐시용)
    summary: pd.summary || null,
    // ── 원본 parsedData 보관 (기존 함수가 직접 접근할 경우)
    _raw: pd,
  };
}

// ═══════════════════════════════════════════════════════════════
// 2. PptMenuRegistry — DB 메뉴 캐시
// ═══════════════════════════════════════════════════════════════

const PptMenuRegistry = (() => {
  let _cache = null;          // { byCode: {DETAIL_SCHEDULE: {...}}, list: [...] }
  let _fetchPromise = null;

  async function load(force = false) {
    if (_cache && !force) return _cache;
    if (_fetchPromise) return _fetchPromise;
    _fetchPromise = fetch('/api/ppt-menus')
      .then(r => r.json())
      .then(json => {
        if (!json.ok) throw new Error('메뉴 로드 실패: ' + json.error);
        // 트리 → 플랫 리스트로 펼치기
        const list = [];
        function flatten(nodes) {
          (nodes || []).forEach(n => {
            list.push(n);
            if (n.children?.length) flatten(n.children);
          });
        }
        flatten(json.data);
        // rule이 있는 메뉴만 실행 가능
        const byCode = {};
        list.forEach(m => { if (m.rule) byCode[m.menu_code] = m; });
        _cache = { byCode, list, tree: json.data };
        _fetchPromise = null;
        return _cache;
      });
    return _fetchPromise;
  }

  function invalidate() { _cache = null; }

  return { load, invalidate };
})();

// ═══════════════════════════════════════════════════════════════
// 3. 범용 mergePresentationZips()
//    - STANDARD: slide XML + rels만 복사 (기존 방식)
//    - FOREIGN_TEMPLATE: master/theme/layout/media까지 복사
// ═══════════════════════════════════════════════════════════════

/**
 * 여러 {zip, mergeStrategy} 파트를 baseZip으로 합본
 *
 * @param {Array<{zip: JSZip, mergeStrategy?: string, slideCount?: number}>} parts
 * @returns {Promise<JSZip>} 합본된 JSZip 객체
 */
async function mergePresentationZips(parts) {
  const usable = parts.filter(p => p && p.zip);
  if (!usable.length) throw new Error('병합할 슬라이드가 없습니다.');

  // ── MASTER_ONLY 전략 ──────────────────────────────────────────
  // 맨 앞 파트가 MASTER_ONLY면 해당 ZIP을 baseZip으로 사용하고
  // 기존 슬라이드(sldIdLst)를 비운 뒤 콘텐츠 파트 전체를
  // FOREIGN_TEMPLATE 방식으로 병합한다.
  // 이렇게 하면 마스터의 slideMaster/Theme/Layout은 그대로 유지되고
  // 콘텐츠 슬라이드들은 _mergeForeign()의 검증된 로직으로 안전하게 추가된다.
  const isMasterFirst = usable[0].mergeStrategy === 'MASTER_ONLY';
  const baseZip       = isMasterFirst ? usable[0].zip : usable[0].zip;
  const contentParts  = isMasterFirst ? usable.slice(1) : usable.slice(1);
  // contentParts[0] = baseZip의 원본 (마스터 없는 경우 index 0, 마스터 있는 경우 index 1)
  // 단, 마스터가 없으면 usable[0]이 그대로 baseZip이므로
  // 아래 루프는 항상 index 0 부터 (baseZip 슬라이드 포함 여부 다름)

  if (isMasterFirst && contentParts.length === 0) throw new Error('생성할 슬라이드가 없습니다.');

  let presXml     = await baseZip.file('ppt/presentation.xml').async('string');
  let presRelsXml = await baseZip.file('ppt/_rels/presentation.xml.rels').async('string');
  let ctXml       = await baseZip.file('[Content_Types].xml').async('string');

  // MASTER_ONLY: baseZip(마스터)의 기존 슬라이드 목록을 비운다
  // → slideMaster/Theme/Layout 체인은 유지, 슬라이드만 제거
  if (isMasterFirst) {
    presXml     = presXml.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, '<p:sldIdLst></p:sldIdLst>');
    presRelsXml = presRelsXml.replace(/<Relationship\b[^/]*Type="[^"]*\/slide"[^/]*\/>/g, '');
    console.log('[PptEngine] 마스터 baseZip 슬라이드 초기화 완료');
  }

  let maxRid   = 0; presRelsXml.replace(/Id="rId(\d+)"/g, (_, n) => { maxRid   = Math.max(maxRid,   +n); return _; });
  let maxSldId = 255; presXml.replace(/<p:sldId id="(\d+)"/g, (_, n) => { maxSldId = Math.max(maxSldId, +n); return _; });

  // master/theme/layout 중복 방지용 경로 → 새 rId 맵
  const foreignPathMap = {};
  let   masterIdx = 100, themeIdx = 100, layoutIdx = 100;

  let newRels = '', newIds = '', newCt = '';
  let sc = 0;

  // ── 콘텐츠 파트 병합 ───────────────────────────────────────────
  // 마스터 있으면 contentParts(slice(1)) 전체 순회
  // 마스터 없으면 usable[0]은 baseZip이므로 index 1부터 순회
  // 단, 마스터 있는 경우 baseZip에 슬라이드가 없으므로
  // contentParts는 모두 FOREIGN_TEMPLATE으로 처리해야 layout 체인이 올바름
  const mergeParts = isMasterFirst ? contentParts : usable.slice(1);

  for (let i = 0; i < mergeParts.length; i++) {
    const part = mergeParts[i];
    const srcZip = part.zip;
    // 마스터가 있을 때: 모든 콘텐츠를 FOREIGN_TEMPLATE으로 처리
    // (마스터의 레이아웃과 원본의 레이아웃 이름이 달라도 _mergeForeign이 올바르게 처리)
    const isForeign = isMasterFirst || (part.mergeStrategy === 'FOREIGN_TEMPLATE');

    const srcPresRels = await srcZip.file('ppt/_rels/presentation.xml.rels').async('string');
    const srcPresXml  = await srcZip.file('ppt/presentation.xml').async('string').catch(() => null);

    if (isForeign) {
      // ── FOREIGN_TEMPLATE: master/theme/layout/media까지 복사 ──
      await _mergeForeign({
        baseZip, srcZip, srcPresXml, srcPresRels,
        presXmlRef: { val: presXml },
        presRelsXmlRef: { val: presRelsXml },
        ctXmlRef: { val: ctXml },
        counters: { maxRid, maxSldId, masterIdx, themeIdx, layoutIdx, sc },
        foreignPathMap,
        newCt_ref: { val: newCt },
        newRels_ref: { val: newRels },
        newIds_ref: { val: newIds },
      });
      // 카운터 동기화
      maxRid      = _counters.maxRid;
      maxSldId    = _counters.maxSldId;
      masterIdx   = _counters.masterIdx;
      themeIdx    = _counters.themeIdx;
      layoutIdx   = _counters.layoutIdx;
      sc          = _counters.sc;
      newRels     = _counters.newRels;
      newIds      = _counters.newIds;
      newCt       = _counters.newCt;
      presXml     = _counters.presXml;
      presRelsXml = _counters.presRelsXml;
      ctXml       = _counters.ctXml;
    } else {
      // ── STANDARD: slide + rels만 복사 — sldIdLst 순서 보장 ──
      const relIdToTgt = {};
      srcPresRels.replace(/<Relationship\b[^>]*\/>/g, tag => {
        const id   = tag.match(/\bId="([^"]+)"/)?.[1];
        const tgt  = tag.match(/\bTarget="([^"]+)"/)?.[1];
        const type = tag.match(/\bType="([^"]+)"/)?.[1] || '';
        if (id && tgt && type.includes('slide') && !type.includes('slideLayout') && !type.includes('slideMaster')) relIdToTgt[id] = tgt;
        return tag;
      });

      // sldIdLst 순서로 정렬
      let orderedTgts = [];
      if (srcPresXml) {
        for (const m of [...srcPresXml.matchAll(/<p:sldId\b[^>]+>/g)]) {
          const rid = m[0].match(/r:id="([^"]+)"/)?.[1];
          if (rid && relIdToTgt[rid]) orderedTgts.push(relIdToTgt[rid]);
        }
      }
      if (!orderedTgts.length) orderedTgts = Object.values(relIdToTgt);

      for (const tgt of orderedTgts) {
        const xml  = await srcZip.file('ppt/' + tgt).async('string').catch(() => null);
        if (!xml) continue;
        const relsPath = 'ppt/' + tgt.replace(/([^/]+)$/, '_rels/$1.rels');
        const rels = await srcZip.file(relsPath).async('string').catch(() => null);
        const newName = 'slideM' + (++sc) + '.xml';
        baseZip.file('ppt/slides/' + newName, xml);
        if (rels) baseZip.file('ppt/slides/_rels/' + newName + '.rels', rels);
        const rid  = 'rId' + (++maxRid); const sldId = ++maxSldId;
        newRels += `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/${newName}"/>`;
        newIds  += `<p:sldId id="${sldId}" r:id="${rid}"/>`;
        newCt   += `<Override PartName="/ppt/slides/${newName}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`;
      }
    }
  }

  // sldIdLst 태그가 없으면 삽입 (마스터 전용 PPTX는 sldIdLst 자체가 없을 수 있음)
  if (!presXml.includes('</p:sldIdLst>')) {
    // sldMasterIdLst 뒤에 삽입
    if (presXml.includes('</p:sldMasterIdLst>')) {
      presXml = presXml.replace('</p:sldMasterIdLst>', '</p:sldMasterIdLst><p:sldIdLst></p:sldIdLst>');
    } else {
      // fallback: </p:presentation> 바로 앞에 삽입
      presXml = presXml.replace('</p:presentation>', '<p:sldIdLst></p:sldIdLst></p:presentation>');
    }
  }

  presRelsXml = presRelsXml.replace('</Relationships>', newRels + '</Relationships>');
  presXml     = presXml.replace('</p:sldIdLst>', newIds + '</p:sldIdLst>');
  ctXml       = ctXml.replace('</Types>', newCt + '</Types>');
  baseZip.file('ppt/presentation.xml', presXml);
  baseZip.file('ppt/_rels/presentation.xml.rels', presRelsXml);
  baseZip.file('[Content_Types].xml', ctXml);

  return baseZip;
}

// foreign merge 전용 내부 카운터 공유 객체
const _counters = {};

/**
 * _injectMaster: 마스터 PPTX의 slideMaster/theme를 baseZip에 이식
 * baseZip 기존 slideMaster를 제거하고 masterZip의 것으로 교체
 */
async function _injectMaster({ baseZip, masterZip, presXmlRef, presRelsXmlRef, ctXmlRef }) {
  let presXml     = presXmlRef.val;
  let presRelsXml = presRelsXmlRef.val;
  let ctXml       = ctXmlRef.val;

  // 1. baseZip 기존 slideMaster rel 목록 수집 후 제거
  const oldMasterRids = [];
  presRelsXml.replace(/<Relationship\b[^>]*\/>/g, tag => {
    if (tag.includes('/slideMaster')) {
      const rid = tag.match(/\bId="([^"]+)"/)?.[1];
      if (rid) oldMasterRids.push(rid);
    }
    return tag;
  });
  // presentation.xml.rels에서 기존 master rel 제거
  presRelsXml = presRelsXml.replace(/<Relationship\b[^>]*\/slideMaster[^>]*\/>/g, '');
  // presentation.xml에서 기존 sldMasterIdLst 비우기
  presXml = presXml.replace(/<p:sldMasterIdLst>[\s\S]*?<\/p:sldMasterIdLst>/, '<p:sldMasterIdLst></p:sldMasterIdLst>');

  // 2. masterZip에서 slideMaster/theme/layout/media 복사
  let maxRid = 0; presRelsXml.replace(/Id="rId(\d+)"/g, (_, n) => { maxRid = Math.max(maxRid, +n); return _; });
  let masterIdx = 100, themeIdx = 100, layoutIdx = 100;
  let newMasterCt = '';

  const masterPresRels = await masterZip.file('ppt/_rels/presentation.xml.rels')?.async('string') ?? '';
  const masterRels = [...masterPresRels.matchAll(/<Relationship\b[^>]*\/>/g)].map(m => m[0]);

  for (const relTag of masterRels) {
    if (!relTag.includes('/slideMaster')) continue;
    const origTarget = relTag.match(/Target="([^"]+)"/)?.[1];
    if (!origTarget) continue;
    const origMasterPath = origTarget.startsWith('ppt/') ? origTarget : 'ppt/' + origTarget.replace(/^slideMasters\//, 'slideMasters/');
    const absOrigPath    = origMasterPath.replace(/^ppt\/ppt\//, 'ppt/');

    // master XML 복사
    const masterXml = await masterZip.file(absOrigPath)?.async('string') ?? null;
    if (!masterXml) continue;
    const newMasterName = `slideMasterI${++masterIdx}.xml`;
    const newMasterPath = `ppt/slideMasters/${newMasterName}`;

    // master .rels 처리
    const origMasterRelsPath = absOrigPath.replace(/([^/]+)$/, '_rels/$1.rels');
    let masterRelsXml = await masterZip.file(origMasterRelsPath)?.async('string') ?? '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';

    // theme 복사
    const themeMatches = [...masterRelsXml.matchAll(/<Relationship\b[^>]*Target="[^"]*theme[^"]*"[^>]*\/>/g)];
    for (const tm of themeMatches) {
      const themeRelTarget = tm[0].match(/Target="([^"]+)"/)?.[1];
      if (!themeRelTarget) continue;
      const origThemePath = ('ppt/slideMasters/' + themeRelTarget).replace(/\/[^/]+\/\.\.\//g, '/');
      const themeBytes = await masterZip.file(origThemePath)?.async('uint8array') ?? null;
      if (themeBytes) {
        const newThemeName = `themeI${++themeIdx}.xml`;
        const newThemePath = `ppt/theme/${newThemeName}`;
        baseZip.file(newThemePath, themeBytes);
        masterRelsXml = masterRelsXml.replace(themeRelTarget, '../../' + newThemePath);
        newMasterCt += `<Override PartName="/${newThemePath}" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`;
      }
    }

    // layout 복사
    const layoutMatches = [...masterRelsXml.matchAll(/<Relationship\b[^>]*Target="[^"]*slideLayout[^"]*"[^>]*\/>/g)];
    let newMasterRelsForLayouts = masterRelsXml;
    for (const lm of layoutMatches) {
      const layoutRelTarget = lm[0].match(/Target="([^"]+)"/)?.[1];
      if (!layoutRelTarget) continue;
      const origLayoutPath = ('ppt/slideMasters/' + layoutRelTarget).replace(/\/[^/]+\/\.\.\//g, '/');
      const layoutXml = await masterZip.file(origLayoutPath)?.async('string') ?? null;
      if (!layoutXml) continue;
      const newLayoutName = `slideLayoutI${++layoutIdx}.xml`;
      const newLayoutPath = `ppt/slideLayouts/${newLayoutName}`;

      // layout .rels
      const origLayoutRelsPath = origLayoutPath.replace(/([^/]+)$/, '_rels/$1.rels');
      let layoutRelsXml = await masterZip.file(origLayoutRelsPath)?.async('string') ?? '';
      if (layoutRelsXml) {
        layoutRelsXml = layoutRelsXml.replace(/Target="[^"]*slideMasters\/[^"]+"/g, `Target="../slideMasters/${newMasterName}"`);
        baseZip.file(`ppt/slideLayouts/_rels/${newLayoutName}.rels`, layoutRelsXml);
      }
      baseZip.file(newLayoutPath, layoutXml);
      newMasterCt += `<Override PartName="/${newLayoutPath}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`;
      newMasterRelsForLayouts = newMasterRelsForLayouts.replace(layoutRelTarget, `../slideLayouts/${newLayoutName}`);
    }

    // media 복사 (master .rels 기준)
    const mediaMatches = [...masterRelsXml.matchAll(/Target="([^"]*media\/[^"]+)"/g)];
    for (const mm of mediaMatches) {
      let mTarget = mm[1];
      if (!mTarget.startsWith('ppt/')) {
        mTarget = ('ppt/slideMasters/' + mTarget).replace(/\/[^/]+\/\.\.\//g, '/');
        if (!mTarget.startsWith('ppt/')) mTarget = 'ppt/' + mTarget;
      }
      const mBytes = await masterZip.file(mTarget)?.async('uint8array') ?? null;
      if (mBytes && !baseZip.file(mTarget)) baseZip.file(mTarget, mBytes);
    }

    baseZip.file(newMasterPath, masterXml);
    baseZip.file(newMasterPath.replace(/([^/]+)$/, '_rels/$1.rels'), newMasterRelsForLayouts);
    newMasterCt += `<Override PartName="/${newMasterPath}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>`;

    // presentation.xml.rels + sldMasterIdLst 에 새 master 등록
    const masterRid = `rId${++maxRid}`;
    presRelsXml = presRelsXml.replace('</Relationships>',
      `<Relationship Id="${masterRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/${newMasterName}"/></Relationships>`);
    presXml = presXml.replace('</p:sldMasterIdLst>',
      `<p:sldMasterId id="${700 + masterIdx}" r:id="${masterRid}"/></p:sldMasterIdLst>`);
  }

  ctXml = ctXml.replace('</Types>', newMasterCt + '</Types>');
  Object.assign(_counters, { presXml, presRelsXml, ctXml, masterIdx, themeIdx, layoutIdx });
}


/**
 * FOREIGN_TEMPLATE 병합 내부 함수
 * master / theme / layout / media 참조 구조를 그대로 복사
 */
/**
 * FOREIGN_TEMPLATE 병합 — prefix 방식
 * 
 * src PPTX의 slides/layouts/masters/themes/media 파일 전체를
 * "p{partIdx}_" prefix 를 붙여 baseZip으로 복사한다.
 * 
 * prefix가 고정되므로:
 *   - 파일명 충돌이 구조적으로 불가능
 *   - rels XML 교체도 단순 문자열 치환 한 방법으로 완결
 */
async function _mergeForeign({ baseZip, srcZip, srcPresXml, srcPresRels, counters,
                                foreignPathMap, presXmlRef, presRelsXmlRef, ctXmlRef,
                                newRels_ref, newIds_ref, newCt_ref }) {
  let { maxRid, maxSldId, sc } = counters;
  let newRels = newRels_ref.val, newIds = newIds_ref.val, newCt = newCt_ref.val;
  let presXml = presXmlRef.val, presRelsXml = presRelsXmlRef.val, ctXml = ctXmlRef.val;

  // ── 이 파트에 고유한 prefix ──────────────────────────────────────
  // foreignPathMap에 이미 처리된 파트 수를 기록해 prefix 결정
  if (!foreignPathMap._partCount) foreignPathMap._partCount = 0;
  const px = `p${++foreignPathMap._partCount}_`;  // e.g. "p1_", "p2_", ...

  // ── src ZIP 내 모든 ppt/ 파일 목록 ───────────────────────────────
  const srcFiles = {};  // { 'ppt/slides/slide1.xml': <ZipObject>, ... }
  srcZip.forEach((relPath, file) => {
    if (relPath.startsWith('ppt/')) srcFiles[relPath] = file;
  });

  // ── 파일명에 prefix 적용하는 헬퍼 ───────────────────────────────
  // ppt/slides/slide1.xml  → ppt/slides/p1_slide1.xml
  // ppt/media/image3.png   → ppt/media/p1_image3.png
  // ppt/theme/theme1.xml   → ppt/theme/p1_theme1.xml
  // ppt/slideLayouts/slideLayout1.xml → ppt/slideLayouts/p1_slideLayout1.xml
  // ppt/slideMasters/slideMaster1.xml → ppt/slideMasters/p1_slideMaster1.xml
  // ppt/slides/_rels/slide1.xml.rels  → ppt/slides/_rels/p1_slide1.xml.rels
  function prefixedPath(origPath) {
    // _rels 폴더 안은 파일명만 prefix
    const m = origPath.match(/^(ppt\/[^/]+\/_rels\/)(.+)$/);
    if (m) return m[1] + px + m[2];
    // 나머지는 마지막 세그먼트에 prefix
    const slash = origPath.lastIndexOf('/');
    return origPath.slice(0, slash + 1) + px + origPath.slice(slash + 1);
  }

  // ── XML 내 내부 참조를 prefix 적용 경로로 치환 ──────────────────
  // 대상: Target="..." 속성값 안의 파일명
  // 단, 외부 URL(http)이나 이미 처리된 경로는 스킵
  function applyPrefixToXml(xml) {
    // Target="...slideLayouts/slideLayout1.xml" 형태를 Target="...slideLayouts/p1_slideLayout1.xml" 로
    // Target="...slideMasters/slideMaster1.xml" → "...slideMasters/p1_slideMaster1.xml"
    // Target="...theme/theme1.xml"              → "...theme/p1_theme1.xml"
    // Target="...media/image3.png"              → "...media/p1_image3.png"
    // Target="...slides/slide1.xml"             → "...slides/p1_slide1.xml"
    // Target="../media/image3.png"              → "../media/p1_image3.png"
    // (relative path 패턴도 처리)
    return xml.replace(/Target="([^"]+)"/g, (match, target) => {
      // http / 절대경로 스킵
      if (target.startsWith('http') || target.startsWith('/')) return match;
      // 이미 prefix 적용된 것 스킵
      if (target.includes('/' + px) || target.startsWith(px)) return match;
      // 마지막 / 뒤 파일명에 prefix 삽입
      const slash = target.lastIndexOf('/');
      if (slash < 0) return `Target="${px}${target}"`;
      return `Target="${target.slice(0, slash + 1)}${px}${target.slice(slash + 1)}"`;
    });
  }

  // ── 1단계: ppt/ 파일 전체 복사 (slide, layout, master, theme, media) ──
  // _rels 파일 포함, 텍스트 파일은 내부 참조에 prefix 적용
  const textExts = new Set(['.xml', '.rels', '.vml', '.vmx']);

  for (const [origPath, zipObj] of Object.entries(srcFiles)) {
    const destPath = prefixedPath(origPath);

    const ext = origPath.slice(origPath.lastIndexOf('.')).toLowerCase();
    if (textExts.has(ext)) {
      let xml = await zipObj.async('string');
      xml = applyPrefixToXml(xml);
      baseZip.file(destPath, xml);
    } else {
      // 미디어 파일(png/jpg/gif/svg 등) — 바이너리 그대로
      const bytes = await zipObj.async('uint8array');
      baseZip.file(destPath, bytes);
    }
  }

  // ── 2단계: presentation.xml 에 master/slide 등록 ────────────────
  // src의 presentation.xml.rels에서 slideMaster 참조 추출
  const masterRids = [];
  srcPresRels.replace(/<Relationship\b[^>]*\/>/g, tag => {
    const type = tag.match(/\bType="([^"]+)"/)?.[1] || '';
    const tgt  = tag.match(/\bTarget="([^"]+)"/)?.[1] || '';
    if (type.includes('/slideMaster') && tgt) {
      // tgt = "slideMasters/slideMaster1.xml" → prefix 적용
      const slash = tgt.lastIndexOf('/');
      const prefixedTgt = slash >= 0
        ? tgt.slice(0, slash + 1) + px + tgt.slice(slash + 1)
        : px + tgt;
      const newRid = `rId${++maxRid}`;
      masterRids.push({ rid: newRid, target: prefixedTgt });
      presRelsXml = presRelsXml.replace('</Relationships>',
        `<Relationship Id="${newRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="${prefixedTgt}"/></Relationships>`);
      presXml = presXml.replace('</p:sldMasterIdLst>',
        `<p:sldMasterId id="${700 + foreignPathMap._partCount * 10}" r:id="${newRid}"/></p:sldMasterIdLst>`);
    }
    return tag;
  });

  // ── 3단계: 슬라이드 순서대로 presentation.xml 에 등록 ──────────
  // rels에서 rId → Target 매핑
  const relIdToTarget = {};
  srcPresRels.replace(/<Relationship\b[^>]*\/>/g, tag => {
    const id   = tag.match(/\bId="([^"]+)"/)?.[1];
    const tgt  = tag.match(/\bTarget="([^"]+)"/)?.[1];
    const type = tag.match(/\bType="([^"]+)"/)?.[1] || '';
    if (id && tgt && type.includes('/slide') && !type.includes('Layout') && !type.includes('Master')) {
      relIdToTarget[id] = tgt;
    }
    return tag;
  });

  // sldIdLst 순서로 정렬
  let orderedTargets = [];
  if (srcPresXml) {
    for (const m of [...srcPresXml.matchAll(/<p:sldId\b[^>]+>/g)]) {
      const rid = m[0].match(/r:id="([^"]+)"/)?.[1];
      if (rid && relIdToTarget[rid]) orderedTargets.push(relIdToTarget[rid]);
    }
  }
  if (!orderedTargets.length) orderedTargets = Object.values(relIdToTarget);

  for (const tgt of orderedTargets) {
    // tgt = "slides/slide1.xml"
    const slash = tgt.lastIndexOf('/');
    const prefixedTgt = slash >= 0
      ? tgt.slice(0, slash + 1) + px + tgt.slice(slash + 1)
      : px + tgt;

    const newName = `p${foreignPathMap._partCount}_s${++sc}.xml`;
    // 이미 prefixedPath로 복사됐으므로 rename이 필요하면 이동
    // (slide 파일은 prefixedPath = ppt/slides/p1_slide1.xml 이지만
    //  presentation.xml에는 slides/ 상대경로로 등록해야 함)
    // → 이미 복사된 파일을 그대로 사용, newName은 등록용만

    // presentation.xml.rels에 slide 등록
    const rid   = `rId${++maxRid}`;
    const sldId = ++maxSldId;
    newRels += `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="${prefixedTgt}"/>`;
    newIds  += `<p:sldId id="${sldId}" r:id="${rid}"/>`;
    newCt   += `<Override PartName="/ppt/${prefixedTgt}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`;
  }

  // master/theme/layout ContentType 등록
  for (const [origPath] of Object.entries(srcFiles)) {
    const destPath = prefixedPath(origPath);
    if (origPath.includes('_rels/') || origPath.includes('/media/')) continue;
    let ct = '';
    if (origPath.match(/slideMasters\/[^/]+\.xml$/))  ct = 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml';
    else if (origPath.match(/slideLayouts\/[^/]+\.xml$/)) ct = 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml';
    else if (origPath.match(/theme\/[^/]+\.xml$/))    ct = 'application/vnd.openxmlformats-officedocument.theme+xml';
    if (ct) newCt += `<Override PartName="/${destPath}" ContentType="${ct}"/>`;
  }

  // 카운터 공유
  Object.assign(_counters, { maxRid, maxSldId,
    masterIdx: counters.masterIdx, themeIdx: counters.themeIdx,
    layoutIdx: counters.layoutIdx, sc,
    newRels, newIds, newCt, presXml, presRelsXml, ctXml });
}

// ═══════════════════════════════════════════════════════════════
// 3.5. 범용 플레이스홀더 치환 헬퍼
//    - XML 특수문자 이스케이프 처리 (& < > ")
//    - 단일 런("[제목]"이 한 <a:r> 안에 그대로) / 분산 런(한글이 여러
//      <a:r>로 쪼개져 "[", "제", "목", "]" 가 따로 있는 경우) 모두 처리
//    - buildHistoryPptx()의 replaceInXml() 로직을 범용화한 버전
// ═══════════════════════════════════════════════════════════════

function escapePptxXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 슬라이드 XML 문자열 하나에서 placeholder(예: '[제목]') → value 치환
 * 서식(런 속성 <a:rPr>)은 항상 첫 번째 겹치는 런의 것을 그대로 유지한다.
 */
function replacePlaceholderInXml(xml, placeholder, rawValue) {
  const value = escapePptxXml(rawValue);

  // Case 1: 플레이스홀더 전체가 단일 <a:t> 안에 그대로 있는 경우
  if (xml.includes(placeholder)) {
    return xml.split(placeholder).join(value);
  }

  // Case 2: 분산 런 — 대괄호 문자조차 없으면 이 슬라이드엔 해당 플레이스홀더가 없음
  const firstChar = placeholder.charAt(0);
  if (!xml.includes(firstChar)) return xml;

  const paraReg = /(<a:p\b[^>]*>)([\s\S]*?)(<\/a:p>)/g;
  let changed = false;
  const result = xml.replace(paraReg, (full, open, inner, close) => {
    const runs = [];
    inner.replace(/<a:r\b[\s\S]*?<\/a:r>/g, run => {
      const t = run.match(/<a:t[^>]*>([^<]*)<\/a:t>/);
      runs.push({ run, text: t ? t[1] : '' });
    });
    const concat = runs.map(r => r.text).join('');
    if (!concat.includes(placeholder)) return full;

    const pStart = concat.indexOf(placeholder);
    const pEnd = pStart + placeholder.length;
    let pos = 0, firstDone = false;
    const newInner = inner.replace(/<a:r\b[\s\S]*?<\/a:r>/g, run => {
      const t = run.match(/<a:t[^>]*>([^<]*)<\/a:t>/);
      const txt = t ? t[1] : '';
      const rStart = pos, rEnd = pos + txt.length;
      pos = rEnd;
      if (txt === '') return run;
      const overlap = rEnd > pStart && rStart < pEnd;
      if (!overlap) return run;
      if (!firstDone) {
        firstDone = true;
        // 첫 겹침 런의 <a:rPr>(서식)은 그대로 두고 텍스트만 교체
        return run.replace(/<a:t([^>]*)>[^<]*<\/a:t>/, `<a:t$1>${value}</a:t>`);
      }
      // 나머지 겹침 런은 텍스트만 비워 제거 (서식 태그는 건드리지 않음 → 레이아웃 유지)
      return run.replace(/<a:t([^>]*)>[^<]*<\/a:t>/, `<a:t$1></a:t>`);
    });
    changed = true;
    return open + newInner + close;
  });
  return changed ? result : xml;
}

/**
 * zip 안의 모든 슬라이드에 걸쳐 여러 플레이스홀더를 한 번에 치환
 * @param {JSZip} zip
 * @param {Record<string,string>} placeholderMap  예: { '[제목]': '3.1 시정조치확인 수행 절차', '[주관기관]': '한국공항공사' }
 */
async function applyPlaceholdersToZip(zip, placeholderMap) {
  const slideFiles = Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  for (const slideFile of slideFiles) {
    let xml = await zip.file(slideFile).async('string');
    for (const [placeholder, value] of Object.entries(placeholderMap)) {
      xml = replacePlaceholderInXml(xml, placeholder, value);
    }
    zip.file(slideFile, xml);
  }
}

// ═══════════════════════════════════════════════════════════════
// 4. generateMenuPpt() — 단일 메뉴 PPT 생성 디스패처
// ═══════════════════════════════════════════════════════════════

/**
 * 메뉴 하나에 해당하는 PPT를 생성하고 {zip, slideCount, mergeStrategy}를 반환
 *
 * @param {object} menu  - ppt_menus row (rule 포함)
 * @param {object} vm    - ProjectViewModel
 * @returns {Promise<{zip: JSZip, slideCount: number, mergeStrategy: string} | null>}
 */
async function generateMenuPpt(menu, vm) {
  if (!menu || !menu.is_enabled) return null;

  const rule = menu.rule;
  if (!rule) {
    console.warn('[PptEngine] rule 없음:', menu.menu_code);
    return null;
  }

  const mergeStrategy = rule.merge_strategy || 'STANDARD';
  let result = null;

  // ── 메뉴 코드별 디스패처 ──
  switch (menu.menu_code) {

    // ── 세부 감리 일정 ─────────────────────────────────────────────
    case 'DETAIL_SCHEDULE':
      result = await downloadDetailSchedule1Pptx(null, { returnZip: true });
      break;

    // ── 사진장표 3종 ───────────────────────────────────────────────
    // 목차 기반: downloadPhotoAssignPptx 내부에서 PptMenuRegistry를 통해
    // 해당 메뉴 코드에 맞는 목차를 자동 구성하므로 별도 주입 불필요.

    // 3.1 단계 감리원의 전문 역량
    case 'AUDITOR_PROFILE':
    case 'PHOTO_ASSIGN':           // 구버전 alias
      result = await downloadPhotoAssignPptx(null, { returnZip: true, menuCode: 'AUDITOR_PROFILE' });
      break;

    // 3.2 핵심기술 점검팀의 전문 역량
    case 'CORE_EXPERT_PROFILE':
      result = await downloadPhotoAssignPptx(null, { returnZip: true, menuCode: 'CORE_EXPERT_PROFILE' });
      break;

    // 3.3 필수기술·보안·테스트팀 전문 역량
    case 'EXPERT_PROFILE':
      result = await downloadPhotoAssignPptx(null, { returnZip: true, menuCode: 'EXPERT_PROFILE' });
      break;

    // ── 감리원/전문가 실적·경력·자격 장표 (플레이스홀더 방식) ──────
    // 3.4 감리원별 유사 감리 실적 및 경력·자격 (1장=2명)
    case 'AUDITOR_HISTORY': {
      const _tpls = Array.isArray(menu.templates) ? menu.templates : [];
      const _tpl  = _tpls.find(t => t.pptx_b64_key) || null;
      console.log('[PptEngine] AUDITOR_HISTORY templates:', _tpls.length, '개, 템플릿 b64:', _tpl ? '있음(길이:'+_tpl.pptx_b64_key.length+')' : 'null');
      const _title_AH = [menu.menu_number, menu.menu_name].filter(Boolean).join(' ');
      result = await buildHistoryPptx({
        returnZip: true,
        groupFilter: 'AUDITOR',
        perPage: 2,
        templateB64: _tpl ? _tpl.pptx_b64_key : null,
        menuTitle: _title_AH,
      });
      break;
    }

    // 3.5 전문가별 유사 감리 실적 및 경력·자격 (1장=4명)
    case 'EXPERT_HISTORY': {
      const _tpls = Array.isArray(menu.templates) ? menu.templates : [];
      const _tpl  = _tpls.find(t => t.pptx_b64_key) || null;
      console.log('[PptEngine] EXPERT_HISTORY templates:', _tpls.length, '개, 템플릿 b64:', _tpl ? '있음(길이:'+_tpl.pptx_b64_key.length+')' : 'null');
      const _title_EH = [menu.menu_number, menu.menu_name].filter(Boolean).join(' ');
      result = await buildHistoryPptx({
        returnZip: true,
        groupFilter: 'EXPERT',
        perPage: 4,
        templateB64: _tpl ? _tpl.pptx_b64_key : null,
        menuTitle: _title_EH,
      });
      break;
    }

    // ── 기존 표장표 (감리원/전문가 통합 표) ───────────────────────
    case 'ASSIGN_TABLE':          // 구버전 alias
    case 'MANPOWER_MD': {
      const _tpls = Array.isArray(menu.templates) ? menu.templates : [];
      const _tpl  = _tpls.find(t => t.pptx_b64_key) || null;
      console.log('[PptEngine] MANPOWER_MD templates:', _tpls.length, '개, 템플릿 b64:', _tpl ? '있음(길이:'+_tpl.pptx_b64_key.length+')' : 'null');
      const _title_MM = [menu.menu_number, menu.menu_name].filter(Boolean).join(' ');
      result = await downloadAssignPptx(null, { returnZip: true, templateB64: _tpl ? _tpl.pptx_b64_key : null, menuTitle: _title_MM });
      break;
    }

    // ── 주관기관 요청사항 준수 여부 (요약표) ──────────────────────
    case 'SUMMARY_TABLE':         // 구버전 alias
    case 'COMPLIANCE':
      result = await downloadSummaryTablePptx(null, { returnZip: true });
      break;

    // ── 3.1 시정조치확인 수행 절차 (플레이스홀더 방식: [제목] + [주관기관]) ──
    case 'ACTION_CONFIRM_PROCEDURE': {
      const _tpls = Array.isArray(menu.templates) ? menu.templates : [];
      const _tpl  = _tpls.find(t => t.pptx_b64_key) || null;
      if (!_tpl) {
        console.warn('[PptEngine] ACTION_CONFIRM_PROCEDURE 템플릿 없음 (건너뜀). PPT 관리 메뉴에서 템플릿을 업로드해 주세요.');
        return null;
      }
      try {
        const b64   = _tpl.pptx_b64_key;
        const bin   = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const zip = await JSZip.loadAsync(bytes);

        const menuTitle = [menu.menu_number, menu.menu_name].filter(Boolean).join(' ');
        const clientOrg = (vm && vm.project && vm.project.client) || '';

        await applyPlaceholdersToZip(zip, {
          '[제목]':     menuTitle,
          '[주관기관]': clientOrg,
        });

        console.log('[PptEngine] ACTION_CONFIRM_PROCEDURE 치환 완료 — 제목:', menuTitle, '/ 주관기관:', clientOrg);
        result = { zip, mergeStrategy: 'FOREIGN_TEMPLATE' };
      } catch (e) {
        console.error('[PptEngine] ACTION_CONFIRM_PROCEDURE 템플릿 로드 실패:', e.message);
        return null;
      }
      break;
    }

    default: {
      // ── 템플릿 파일 직접 합본 (데이터 연동 미구현 메뉴) ──────────
      // menu.templates 배열에서 pptx_b64_key가 있는 첫 번째 템플릿을 사용
      const tpls = Array.isArray(menu.templates) ? menu.templates : [];
      const tpl  = tpls.find(t => t.pptx_b64_key) || null;
      if (!tpl) {
        console.warn('[PptEngine] 템플릿 없음 (건너뜀):', menu.menu_code, menu.menu_name);
        return null;
      }
      try {
        // base64 → Uint8Array → JSZip
        const b64   = tpl.pptx_b64_key;
        const bin   = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const zip = await JSZip.loadAsync(bytes);

        // ── [제목] 플레이스홀더 → 목차명 치환 ──────────────────────
        // 목차명: menu_number + menu_name (예: "1.1 감리 수행 소식")
        const menuTitle = [menu.menu_number, menu.menu_name].filter(Boolean).join(' ');
        const slideFiles2 = Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f));
        for (const slideFile of slideFiles2) {
          let xml = await zip.file(slideFile).async('string');

          // Case 1: 단일 런에 [제목] 그대로 있는 경우 (가장 빠른 경로)
          if (xml.includes('[제목]')) {
            xml = xml.replace(/\[제목\]/g, menuTitle);
            zip.file(slideFile, xml);
            console.log('[PptEngine] [제목] 단순치환:', slideFile);
            continue;
          }

          // Case 2: 분산 런 — [, 제목, ] 가 각각 별개 <a:r>에 분리된 경우
          // 핵심: <a:r> 먼저 분리 → <a:t>([^<]*)</a:t> 로 순수 텍스트 추출
          // ※ [\s\S]*? 쓰면 <a:rPr> 내부 태그 텍스트까지 포함해 오동작함
          if (xml.includes('제목')) {
            const paraReg = /(<a:p\b[^>]*>)([\s\S]*?)(<\/a:p>)/g;
            let changed = false;
            xml = xml.replace(paraReg, (full, open, inner, close) => {
              // ① <a:r> 단위 분리 + [^<]* 로 순수 텍스트만 추출
              const runs = [];
              inner.replace(/<a:r\b[\s\S]*?<\/a:r>/g, run => {
                const t = run.match(/<a:t[^>]*>([^<]*)<\/a:t>/);
                runs.push({ run, text: t ? t[1] : '' });
              });
              const concat = runs.map(r => r.text).join('');
              if (!concat.includes('[제목]')) return full;

              // ② 포지션 기반으로 [제목] 구간에 걸치는 런 식별
              const jStart = concat.indexOf('[제목]');   // inclusive
              const jEnd   = jStart + 4;                 // '[제목]'.length = 4 (chars: [,제,목,])

              let pos = 0;
              let firstJRun = true; // [제목] 구간 첫 런 여부
              const newInner = inner.replace(/<a:r\b[\s\S]*?<\/a:r>/g, run => {
                const t = run.match(/<a:t[^>]*>([^<]*)<\/a:t>/);
                const txt = t ? t[1] : '';
                const rStart = pos;
                const rEnd   = pos + txt.length;
                pos = rEnd;

                // 텍스트 없는 런 → 그대로 유지
                if (txt === '') return run;

                const overlap = rEnd > jStart && rStart < jEnd;  // [제목] 구간과 겹치는가
                if (!overlap) return run;                         // 무관 런 → 그대로

                if (firstJRun) {
                  // [제목] 구간의 첫 번째 런 → menuTitle 로 교체
                  firstJRun = false;
                  return run.replace(/<a:t([^>]*)>[^<]*<\/a:t>/, `<a:t$1>${menuTitle}</a:t>`);
                }
                // [제목] 구간의 나머지 런 → 제거
                return '';
              });

              changed = true;
              console.log('[PptEngine] [제목] 분산런 치환:', slideFile, '→', menuTitle);
              return open + newInner + close;
            });
            if (changed) zip.file(slideFile, xml);
          }
        }

        console.log('[PptEngine] 템플릿 삽입:', menu.menu_code, '-', tpl.pptx_file_path || tpl.template_name);
        result = { zip, mergeStrategy: 'FOREIGN_TEMPLATE' };
      } catch (e) {
        console.error('[PptEngine] 템플릿 로드 실패:', menu.menu_code, e.message);
        return null;
      }
      break;
    }

  }  // end switch

  if (!result || !result.zip) return null;

  // 슬라이드 수 계산
  let slideCount = 0;
  try {
    const presXml = await result.zip.file('ppt/presentation.xml').async('string');
    slideCount = (presXml.match(/<p:sldId\b/g) || []).length;
  } catch (_) { slideCount = 1; }

  return { ...result, slideCount, mergeStrategy };
}

// ═══════════════════════════════════════════════════════════════
// 5. generateProposalPpt() — 전체 메뉴 Composer
// ═══════════════════════════════════════════════════════════════

/**
 * 활성화된 메뉴를 sort_order 순으로 순회하며 각 PPT를 생성하고
 * mergePresentationZips()로 하나의 최종 PPTX를 합본한다.
 *
 * 마스터 템플릿이 활성화되어 있으면 해당 PPTX를 parts[0]에 삽입하여
 * 모든 슬라이드가 동일한 slideMaster/Theme/Layout을 참조하게 한다.
 *
 * @param {object} vm - ProjectViewModel
 * @returns {Promise<JSZip>} 최종 합본 JSZip 객체
 */
async function generateProposalPpt(vm) {
  // 1. 메뉴 목록 로드
  const registry = await PptMenuRegistry.load();
  const enabledMenus = Object.values(registry.byCode)
    .filter(m => m.is_enabled && m.rule)
    .sort((a, b) => a.sort_order - b.sort_order);

  if (!enabledMenus.length) throw new Error('활성화된 메뉴가 없습니다.');

  // 2. 마스터 템플릿 로드 (활성화된 것이 있으면)
  let masterPart = null;
  try {
    const mr = await fetch('/api/ppt-menus/master-templates/active');
    const mj = await mr.json();
    if (mj.ok && mj.data?.pptx_b64) {
      const b64  = mj.data.pptx_b64;
      const bin  = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const zip = await JSZip.loadAsync(bytes);
      masterPart = { zip, mergeStrategy: 'MASTER_ONLY', name: mj.data.name };
      console.log('[PptEngine] 마스터 템플릿 로드:', mj.data.name);
    }
  } catch (e) {
    console.warn('[PptEngine] 마스터 템플릿 로드 실패 (무시):', e.message);
  }

  // 3. 각 메뉴 PPT 생성
  showAutoAlert('⏳ PPT 생성 중... 완료될 때까지 잠시 기다려주세요.', false);

  const parts = [];
  for (const menu of enabledMenus) {
    try {
      const part = await generateMenuPpt(menu, vm);
      if (part && part.slideCount > 0) {
        parts.push(part);
        console.log(`[PptEngine] ${menu.menu_code} → ${part.slideCount}장`);
      } else {
        console.log(`[PptEngine] ${menu.menu_code} → 0장 (건너뜀)`);
      }
    } catch (e) {
      console.error(`[PptEngine] ${menu.menu_code} 생성 실패:`, e);
      // 개별 메뉴 실패는 건너뛰고 계속 진행
    }
  }

  if (!parts.length) throw new Error('생성할 슬라이드가 없습니다.');

  // 4. 합본
  // 마스터 템플릿이 있으면 맨 앞에 삽입 → baseZip으로 사용
  // MASTER_ONLY 전략: 슬라이드는 0장이지만 master/theme/layout 체인을 제공
  if (masterPart) {
    parts.unshift(masterPart);
  }
  return mergePresentationZips(parts);
}

// ═══════════════════════════════════════════════════════════════
// 6. downloadProposalPpt() — 최종 다운로드 래퍼
//    (기존 downloadAllPptx 대체)
// ═══════════════════════════════════════════════════════════════

async function downloadProposalPpt(btn) {
  if (typeof PptxGenJS === 'undefined' || typeof JSZip === 'undefined') {
    alert('PPT 라이브러리 로딩 중입니다. 잠시 후 다시 시도해주세요.'); return;
  }
  setBtnState(btn, true);
  try {
    const vm = buildProjectViewModel(parsedData);
    const finalZip = await generateProposalPpt(vm);

    const blob = await finalZip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    const d = new Date();
    const dateStr = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '자동화PPT_' + (parsedData.projectTitle || '').slice(0, 10) + '_' + dateStr + '.pptx';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showAutoAlert('✅ 자동화 PPT 생성 완료!', true);
  } catch (e) {
    showAutoAlert('❌ 생성 실패: ' + e.message, false);
    console.error(e);
  } finally {
    setBtnState(btn, false);
  }
}

// ═══════════════════════════════════════════════════════════════
// 7. 메뉴 캐시 강제 재로드 유틸
// ═══════════════════════════════════════════════════════════════

function invalidatePptMenuCache() {
  PptMenuRegistry.invalidate();
}
