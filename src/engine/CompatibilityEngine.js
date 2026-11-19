/**
 * CompatibilityEngine
 * ----------------
 * 按需求文档第 9 节定义兼容性等级：
 * FULL / PARTIAL / UNSUPPORTED / INVALID。
 *
 * 阶段 1 只评估“结构检测”链路，不把结构识别成功当成图形解析成功。
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
 * @param {ReturnType<import('../core/AIFileDetector.js').detectStructure>} report
 */
export function buildCompatibilityReport(report) {
  const containerKnown = report.detection.container !== 'unknown'
  const privateData = report.privateData
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
      privateData.status === 'absent'
        ? SupportLevel.UNSUPPORTED
        : SupportLevel.FULL,
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
    item('PostScript / PGF 图形解析', SupportLevel.UNSUPPORTED, '计划于阶段 2 实现'),
    item('Scene Graph 构建', SupportLevel.UNSUPPORTED, '计划于阶段 3 实现'),
    item('Canvas 矢量渲染', SupportLevel.UNSUPPORTED, '计划于阶段 4 实现'),
    item(
      'PDF 预览图提取',
      SupportLevel.UNSUPPORTED,
      '按需求文档要求，不读取 PDF 预览图冒充 AI 解析结果',
    ),
  ]

  let overall
  if (!containerKnown) {
    overall = SupportLevel.INVALID
  } else if (privateData.status === 'failed') {
    overall = SupportLevel.INVALID
  } else {
    overall = SupportLevel.PARTIAL
  }

  return {
    stage: 1,
    overall,
    overallLabel: LEVEL_LABELS[overall],
    note:
      overall === SupportLevel.PARTIAL
        ? '阶段 1 仅验证文件结构与私有数据可访问性，尚未实现矢量图形解析和渲染。'
        : '当前文件未通过阶段 1 结构检测，详情见诊断信息。',
    items,
  }
}
