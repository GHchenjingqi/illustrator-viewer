/**
 * CompatibilityEngine
 * ----------------
 * 按需求文档第 9 节定义兼容性等级：
 * FULL / PARTIAL / UNSUPPORTED / INVALID。
 *
 * 阶段 2 只评估“结构检测 + 基础绘图解析”链路。
 * 由于尚未用真实 Illustrator 样本验证，任何图形能力最高只能标记为 PARTIAL。
 */

export const SupportLevel = Object.freeze({
  FULL: 'FULL',
  PARTIAL: 'PARTIAL',
  UNSUPPORTED: 'UNSUPPORTED',
  INVALID: 'INVALID',
})

const LEVEL_LABELS = Object.freeze({
  FULL: '完整支持',
  PARTIAL: '部分支持',
  UNSUPPORTED: '暂不支持',
  INVALID: '数据无效',
})

function item(feature, level, detail) {
  return { feature, level, label: LEVEL_LABELS[level], detail }
}

/**
 * @param {object} report
 */
export function buildCompatibilityReport(report) {
  const containerKnown = report.detection.container !== 'unknown'
  const privateData = report.privateData
  const graphics = report.graphics ?? {
    status: 'skipped',
    tokenCount: 0,
    vectorCount: 0,
    unknownOperators: [],
    artboards: [],
    stats: {},
    reason: null,
  }

  const parsed = graphics.status === 'parsed'
  const hasVectors = (graphics.vectorCount ?? 0) > 0
  const unknownCount = graphics.unknownOperators?.length ?? 0
  const vectorTypes = hasVectors
    ? [...new Set(graphics.vectors.map((vector) => vector.type))].join(' / ')
    : '—'

  const items = [
    item(
      '文件结构识别',
      containerKnown ? SupportLevel.FULL : SupportLevel.INVALID,
      containerKnown
        ? `已识别为 ${report.detection.containerLabel}`
        : '未识别 PDF / EPS / PostScript 特征',
    ),
    item(
      'Illustrator 私有数据定位',
      privateData.status === 'absent' ? SupportLevel.UNSUPPORTED : SupportLevel.FULL,
      privateData.status === 'absent'
        ? '未发现私有数据标记；是否为普通 PDF 尚需进一步确认'
        : `已定位 ${privateData.marker}（偏移 ${privateData.markerOffset}）`,
    ),
    item(
      '私有数据解码',
      privateData.status === 'decoded'
        ? SupportLevel.FULL
        : privateData.status === 'skipped'
          ? SupportLevel.PARTIAL
          : privateData.status === 'failed'
            ? SupportLevel.INVALID
            : SupportLevel.UNSUPPORTED,
      privateData.status === 'decoded'
        ? `解码后 ${privateData.decodedBytes} 字节，压缩方式 ${privateData.compression}`
        : privateData.error ?? '当前阶段未解码或环境不支持',
    ),
    item(
      'PostScript / 基础绘图解析',
      parsed
        ? SupportLevel.PARTIAL
        : graphics.status === 'failed'
          ? SupportLevel.INVALID
          : SupportLevel.UNSUPPORTED,
      parsed
        ? `已执行 ${graphics.tokenCount} 个 token / ${graphics.stats?.operatorsExecuted ?? 0} 个白名单操作符；未识别操作符 ${unknownCount} 种`
        : graphics.reason ?? '没有可解析的绘图文本',
    ),
    item(
      '基础矢量对象提取',
      hasVectors ? SupportLevel.PARTIAL : SupportLevel.UNSUPPORTED,
      hasVectors
        ? `已提取 ${graphics.vectorCount} 个对象（${vectorTypes}）；仅覆盖路径、颜色与线型子集`
        : '尚未提取到路径或线段对象',
    ),
    item(
      '画板信息',
      graphics.artboards?.length ? SupportLevel.PARTIAL : SupportLevel.UNSUPPORTED,
      graphics.artboards?.length
        ? `找到 ${graphics.artboards.length} 个画板候选，来源为页面边界推断，非 Illustrator 原生画板数据`
        : '未找到 BoundingBox / MediaBox 等边界提示',
    ),
    item(
      'PGF 原生图层语义',
      SupportLevel.UNSUPPORTED,
      '阶段 2 仅执行通用 PostScript 子集；图层、画板、文本、图片等原生语义尚未用真实样本验证',
    ),
    item('Scene Graph 构建', SupportLevel.UNSUPPORTED, '计划于阶段 3 实现'),
    item('Canvas 矢量渲染', SupportLevel.UNSUPPORTED, '计划于阶段 4 实现'),
    item(
      'PDF 预览图提取',
      SupportLevel.UNSUPPORTED,
      '按需求文档要求，不读取 PDF 预览图冒充 AI 解析结果',
    ),
  ]

  let overall
  if (!containerKnown || privateData.status === 'failed' || graphics.status === 'failed') {
    overall = SupportLevel.INVALID
  } else {
    overall = SupportLevel.PARTIAL
  }

  return {
    stage: 2,
    overall,
    overallLabel: LEVEL_LABELS[overall],
    note:
      overall === SupportLevel.PARTIAL
        ? '阶段 2 已实现结构检测与基础矢量提取，但尚未实现 Scene Graph / Canvas 渲染，且缺少真实 AI 样本验证。'
        : '当前文件未通过阶段 2 解析，详情见诊断信息。',
    items,
  }
}
