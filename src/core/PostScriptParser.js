/**
 * PostScriptParser
 * ----------------
 * 一个受限制的、只面向绘图的 PostScript / AI 私有数据解释器。
 *
 * 设计原则：
 * - 只执行白名单操作符；不执行过程体、不执行文件/网络/系统操作。
 * - 未知操作符记录操作符名、首次偏移与出现次数，然后安全跳过。
 * - 路径坐标保持矢量形式，不栅格化。
 * - 不支持的效果（文字、图片、裁剪、图案）明确记录，不猜测绘制结果。
 *
 * 阶段 2 的解析能力是实验性的：尚未用真实 Illustrator 样本校准。
 */

import { PostScriptLexer, PostScriptTokenType } from './PostScriptLexer.js'
import { PostScriptGraphicsState, clonePaint } from './PostScriptGraphicsState.js'
import { VectorBuilder } from './VectorParser.js'
import { extractPageBoxes, pageBoxesToArtboards } from './PageBoxExtractor.js'
import {
  createDiagnostic,
  DiagnosticSeverity,
} from '../utils/errors.js'
import {
  concatMatrix,
  multiplyMatrix,
  rotationMatrix,
  scalingMatrix,
  translationMatrix,
} from '../engine/TransformEngine.js'

const DEFAULTS = Object.freeze({
  maxTokens: 200000,
  maxStack: 10000,
  maxObjects: 50000,
  maxPoints: 1000000,
  maxUnknownOperators: 2000,
  maxDiagnostics: 200,
})

const COLOR_SPACES = Object.freeze({
  DeviceRGB: 'rgb',
  DeviceCMYK: 'cmyk',
  DeviceGray: 'gray',
  RGB: 'rgb',
  CMYK: 'cmyk',
  G: 'gray',
})

const WHITELIST = new Set([
  // 路径
  'moveto', 'm', 'lineto', 'l', 'curveto', 'c', 'v', 'y', 'closepath', 'h',
  'newpath', 'n', 're', 'rect',
  // 绘制
  'fill', 'f', 'eofill', 'f*', 'stroke', 'S', 's', 'B', 'B*', 'b', 'b*',
  'fillstroke', 'clip', 'W', 'W*', 'eoclip',
  // 颜色
  'setrgbcolor', 'rg', 'setgray', 'g', 'setcmykcolor', 'k', 'sethsbcolor',
  'RG', 'G', 'K', 'cs', 'CS', 'sc', 'scn', 'SC', 'SCN',
  // 线型
  'setlinewidth', 'w', 'setlinecap', 'J', 'setlinejoin', 'j',
  'setmiterlimit', 'M', 'setdash', 'd',
  // 图形状态与变换
  'gsave', 'grestore', 'q', 'Q', 'translate', 'scale', 'rotate', 'concat', 'cm',
  // 栈与算术
  'add', 'sub', 'mul', 'div', 'neg', 'dup', 'pop', 'exch', 'copy', 'index',
  'clear', 'idiv', 'mod',
  // 过程/字典（安全跳过，不执行）
  'def', 'bind', 'dict', 'begin', 'end', 'currentdict',
])

const UNSUPPORTED_COLLECTIONS = Object.freeze({
  text: new Set(['show', 'Tj', 'TJ', 'Tf', 'Td', 'TD', 'Tm', 'T*', 'BT', 'ET', 'Tc', 'Tw', 'Tz', 'TL', 'Ts', 'Tr']),
  image: new Set(['image', 'Do', 'BI', 'ID', 'EI']),
  graphicsState: new Set(['gs', 'sh', 'SMask', 'ca', 'CA', 'BM', 'OP', 'op']),
})

function isName(value) {
  return Boolean(value && typeof value === 'object' && typeof value.__name === 'string')
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function hsbToRgb(h, s, b) {
  const hue = ((h % 1) + 1) % 1
  const saturation = clamp(s, 0, 1)
  const brightness = clamp(b, 0, 1)
  if (saturation <= 0) return [brightness, brightness, brightness]

  const scaled = hue * 6
  const sector = Math.floor(scaled)
  const fraction = scaled - sector
  const p = brightness * (1 - saturation)
  const q = brightness * (1 - saturation * fraction)
  const t = brightness * (1 - saturation * (1 - fraction))

  switch (sector % 6) {
    case 0:
      return [brightness, t, p]
    case 1:
      return [q, brightness, p]
    case 2:
      return [p, brightness, t]
    case 3:
      return [p, q, brightness]
    case 4:
      return [t, p, brightness]
    default:
      return [brightness, p, q]
  }
}

export class PostScriptParser {
  /**
   * @param {{ maxTokens?: number, maxStack?: number, maxObjects?: number, maxPoints?: number }} [options]
   */
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options }
    this.reset()
  }

  reset() {
    this.stack = []
    this.stateStack = []
    this.graphics = new PostScriptGraphicsState()
    this.builder = new VectorBuilder({ maxObjects: this.options.maxObjects })
    this.subpaths = []
    this.currentSubpath = null
    this.currentPoint = null
    this.pointCount = 0
    this.pathDisabled = false
    this.unknownOperators = new Map()
    this.featureCounts = new Map()
    this.diagnostics = []
    this.stats = {
      operatorsExecuted: 0,
      operatorsSkipped: 0,
      procedureBlocks: 0,
      dictBlocks: 0,
      textOperators: 0,
      imageOperators: 0,
      graphicsStateOperators: 0,
      clipOperators: 0,
      paintedObjects: 0,
      suppressedPaths: 0,
      maxStackObserved: 0,
      leftoverOperands: 0,
    }
    this.truncated = false
    this.truncatedReason = null
  }

  /**
   * @param {string} source
   * @param {{ mode?: string, source?: string, artboardHints?: object[] }} [options]
   */
  parse(source, options = {}) {
    this.reset()
    const lexerResult = new PostScriptLexer(source, {
      maxTokens: this.options.maxTokens,
    }).tokenize()

    this.diagnostics.push(...lexerResult.diagnostics)
    if (lexerResult.truncated) {
      this.truncated = true
      this.truncatedReason = 'token-limit'
    }

    this.executeTokens(lexerResult.tokens)

    const artboardHints =
      Array.isArray(options.artboardHints) && options.artboardHints.length > 0
        ? options.artboardHints
        : extractPageBoxes(source, { limit: 24 })
    const artboards = pageBoxesToArtboards(artboardHints)

    this.stats.leftoverOperands = this.stack.length

    return {
      status: lexerResult.tokenCount > 0 ? 'parsed' : 'empty',
      mode: options.mode ?? 'postscript',
      source: options.source ?? null,
      tokenCount: lexerResult.tokenCount,
      truncated: this.truncated || this.builder.truncated,
      truncatedReason: this.truncatedReason ?? (this.builder.truncated ? 'object-limit' : null),
      vectors: this.builder.objects,
      vectorCount: this.builder.objects.length,
      artboards,
      artboardHintCount: artboardHints.length,
      unknownOperators: this.collectUnknownOperators(),
      unsupportedFeatures: this.collectFeatures(),
      diagnostics: this.diagnostics,
      stats: { ...this.stats },
    }
  }

  executeTokens(tokens) {
    let index = 0
    while (index < tokens.length) {
      const token = tokens[index]

      switch (token.type) {
        case PostScriptTokenType.NUMBER:
        case PostScriptTokenType.STRING:
        case PostScriptTokenType.HEX_STRING:
        case PostScriptTokenType.BOOLEAN:
          this.push(token.value)
          index += 1
          break

        case PostScriptTokenType.NAME:
          this.push({ __name: token.value })
          index += 1
          break

        case PostScriptTokenType.ARRAY_START: {
          const result = this.collectArray(tokens, index)
          this.push(result.value)
          index = result.next
          break
        }

        case PostScriptTokenType.BRACE_START:
          this.stats.procedureBlocks += 1
          this.recordFeature('procedure', '过程体不执行（安全限制）')
          index = this.skipBalanced(
            tokens,
            index,
            PostScriptTokenType.BRACE_START,
            PostScriptTokenType.BRACE_END,
          )
          break

        case PostScriptTokenType.DICT_START:
          this.stats.dictBlocks += 1
          this.recordFeature('dict', '字典不求值，仅跳过')
          index = this.skipBalanced(
            tokens,
            index,
            PostScriptTokenType.DICT_START,
            PostScriptTokenType.DICT_END,
          )
          break

        case PostScriptTokenType.ARRAY_END:
        case PostScriptTokenType.DICT_END:
        case PostScriptTokenType.BRACE_END:
          this.diagnose(
            'UNEXPECTED_TOKEN',
            `未匹配的结束符号：${token.value}`,
            DiagnosticSeverity.INFO,
            { offset: token.offset, line: token.line },
          )
          index += 1
          break

        case PostScriptTokenType.OPERATOR:
          this.executeOperator(token)
          index += 1
          break

        default:
          index += 1
      }
    }
  }

  push(value) {
    if (this.stack.length >= this.options.maxStack) {
      this.stack.shift()
      this.truncated = true
      this.truncatedReason = this.truncatedReason ?? 'stack-limit'
    }
    this.stack.push(value)
    this.stats.maxStackObserved = Math.max(this.stats.maxStackObserved, this.stack.length)
  }

  pop() {
    return this.stack.pop()
  }

  takeNumbers(count) {
    if (this.stack.length < count) {
      this.diagnose(
        'STACK_UNDERFLOW',
        `操作符需要 ${count} 个数字，但栈中只有 ${this.stack.length} 个值`,
        DiagnosticSeverity.WARNING,
      )
      return null
    }
    const values = this.stack.slice(-count)
    if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
      this.diagnose(
        'TYPE_ERROR',
        `操作符需要 ${count} 个数字，但操作数类型不匹配`,
        DiagnosticSeverity.WARNING,
      )
      return null
    }
    this.stack.length -= count
    return values
  }

  takeArray() {
    const value = this.pop()
    if (!Array.isArray(value)) {
      this.diagnose('TYPE_ERROR', '操作符需要一个数组操作数', DiagnosticSeverity.WARNING)
      return null
    }
    return value
  }

  takeName() {
    const value = this.pop()
    if (!isName(value)) {
      this.diagnose('TYPE_ERROR', '操作符需要一个名字操作数（/Name）', DiagnosticSeverity.WARNING)
      return null
    }
    return value.__name
  }

  collectArray(tokens, startIndex) {
    const items = []
    let index = startIndex + 1

    while (index < tokens.length) {
      const token = tokens[index]
      if (token.type === PostScriptTokenType.ARRAY_END) {
        return { value: items, next: index + 1 }
      }
      if (token.type === PostScriptTokenType.ARRAY_START) {
        const nested = this.collectArray(tokens, index)
        items.push(nested.value)
        index = nested.next
        continue
      }
      if (
        token.type === PostScriptTokenType.NUMBER ||
        token.type === PostScriptTokenType.STRING ||
        token.type === PostScriptTokenType.HEX_STRING ||
        token.type === PostScriptTokenType.BOOLEAN
      ) {
        items.push(token.value)
        index += 1
        continue
      }
      if (token.type === PostScriptTokenType.NAME) {
        items.push({ __name: token.value })
        index += 1
        continue
      }

      this.recordFeature('array-content', '数组内包含未求值的复杂内容')
      index += 1
    }

    this.diagnose('UNTERMINATED_ARRAY', '数组未闭合', DiagnosticSeverity.WARNING, {
      offset: tokens[startIndex]?.offset,
    })
    return { value: items, next: index }
  }

  skipBalanced(tokens, startIndex, openType, closeType) {
    let depth = 1
    let index = startIndex + 1
    while (index < tokens.length && depth > 0) {
      if (tokens[index].type === openType) depth += 1
      else if (tokens[index].type === closeType) depth -= 1
      index += 1
    }
    return index
  }

  recordFeature(key, detail) {
    const existing = this.featureCounts.get(key)
    if (existing) {
      existing.count += 1
      return
    }
    this.featureCounts.set(key, { feature: key, detail, count: 1 })
  }

  collectFeatures() {
    return [...this.featureCounts.values()].sort((a, b) => b.count - a.count)
  }

  collectUnknownOperators() {
    return [...this.unknownOperators.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, this.options.maxUnknownOperators)
  }

  diagnose(code, message, severity = DiagnosticSeverity.WARNING, details = {}) {
    if (this.diagnostics.length >= this.options.maxDiagnostics) return
    this.diagnostics.push(createDiagnostic(code, message, severity, details))
  }

  executeOperator(token) {
    const operator = token.value

    if (!WHITELIST.has(operator)) {
      this.stats.operatorsSkipped += 1
      this.recordUnknownOperator(operator, token)
      this.recordUnsupportedCollections(operator)
      return
    }

    this.stats.operatorsExecuted += 1

    switch (operator) {
      // ---------- 路径 ----------
      case 'moveto':
      case 'm': {
        const values = this.takeNumbers(2)
        if (values) this.startSubpath(values[0], values[1])
        break
      }
      case 'lineto':
      case 'l': {
        const values = this.takeNumbers(2)
        if (values) this.appendLine(values[0], values[1])
        break
      }
      case 'curveto':
      case 'c': {
        const values = this.takeNumbers(6)
        if (values) {
          this.appendCurve(values[0], values[1], values[2], values[3], values[4], values[5])
        }
        break
      }
      case 'v': {
        const values = this.takeNumbers(4)
        if (values) {
          const current = this.currentPoint ?? { x: 0, y: 0 }
          this.appendCurve(current.x, current.y, values[0], values[1], values[2], values[3])
        }
        break
      }
      case 'y': {
        const values = this.takeNumbers(4)
        if (values) {
          this.appendCurve(values[0], values[1], values[2], values[3], values[2], values[3])
        }
        break
      }
      case 'closepath':
      case 'h':
        this.closeSubpath()
        break

      case 'newpath':
      case 'n':
        this.resetPath()
        break

      case 're':
      case 'rect': {
        const values = this.takeNumbers(4)
        if (values) this.appendRectangle(values[0], values[1], values[2], values[3])
        break
      }

      // ---------- 绘制 ----------
      case 'fill':
      case 'f':
        this.paint({ fill: true, stroke: false, fillRule: 'nonzero' })
        break
      case 'eofill':
      case 'f*':
        this.paint({ fill: true, stroke: false, fillRule: 'evenodd' })
        break
      case 'stroke':
      case 'S':
        this.paint({ fill: false, stroke: true, fillRule: null })
        break
      case 's':
        this.closeAllSubpaths()
        this.paint({ fill: false, stroke: true, fillRule: null })
        break
      case 'B':
      case 'fillstroke':
        this.paint({ fill: true, stroke: true, fillRule: 'nonzero' })
        break
      case 'B*':
        this.paint({ fill: true, stroke: true, fillRule: 'evenodd' })
        break
      case 'b':
        this.closeAllSubpaths()
        this.paint({ fill: true, stroke: true, fillRule: 'nonzero' })
        break
      case 'b*':
        this.closeAllSubpaths()
        this.paint({ fill: true, stroke: true, fillRule: 'evenodd' })
        break

      case 'clip':
      case 'W':
      case 'W*':
      case 'eoclip':
        this.stats.clipOperators += 1
        this.graphics.clipDepth += 1
        this.recordFeature('clip', '裁剪路径已记录，但阶段 2 不参与渲染')
        break

      // ---------- 颜色 ----------
      case 'setrgbcolor':
      case 'rg': {
        const values = this.takeNumbers(3)
        if (values) this.graphics.fillColor = { type: 'rgb', values }
        break
      }
      case 'setgray':
      case 'g': {
        const values = this.takeNumbers(1)
        if (values) this.graphics.fillColor = { type: 'gray', values }
        break
      }
      case 'setcmykcolor':
      case 'k': {
        const values = this.takeNumbers(4)
        if (values) this.graphics.fillColor = { type: 'cmyk', values }
        break
      }
      case 'RG': {
        const values = this.takeNumbers(3)
        if (values) this.graphics.strokeColor = { type: 'rgb', values }
        break
      }
      case 'G': {
        const values = this.takeNumbers(1)
        if (values) this.graphics.strokeColor = { type: 'gray', values }
        break
      }
      case 'K': {
        const values = this.takeNumbers(4)
        if (values) this.graphics.strokeColor = { type: 'cmyk', values }
        break
      }
      case 'sethsbcolor': {
        const values = this.takeNumbers(3)
        if (values) {
          const [r, g, b] = hsbToRgb(values[0], values[1], values[2])
          this.graphics.fillColor = { type: 'rgb', values: [r, g, b] }
        }
        break
      }
      case 'cs':
      case 'CS': {
        const name = this.takeName()
        if (name) {
          const space = COLOR_SPACES[name]
          if (!space) {
            this.recordFeature('colorspace', `未支持的颜色空间：${name}`)
            this.diagnose(
              'UNSUPPORTED_COLORSPACE',
              `未支持的颜色空间：${name}`,
              DiagnosticSeverity.WARNING,
            )
          } else if (operator === 'cs') {
            this.graphics.fillColorSpace = space
          } else {
            this.graphics.strokeColorSpace = space
          }
        }
        break
      }
      case 'sc':
      case 'scn':
      case 'SC':
      case 'SCN': {
        const isStroke = operator === 'SC' || operator === 'SCN'
        const space = isStroke ? this.graphics.strokeColorSpace : this.graphics.fillColorSpace
        if (space !== 'rgb' && space !== 'cmyk' && space !== 'gray') {
          this.recordFeature('colorspace', 'sc/scn 缺少可识别的颜色空间')
          break
        }
        const expected = { gray: 1, rgb: 3, cmyk: 4 }[space]
        const values = this.takeNumbers(expected)
        if (values) {
          const paint = { type: space, values }
          if (isStroke) this.graphics.strokeColor = paint
          else this.graphics.fillColor = paint
        }
        break
      }

      // ---------- 线型 ----------
      case 'setlinewidth':
      case 'w': {
        const values = this.takeNumbers(1)
        if (values && values[0] >= 0) this.graphics.lineWidth = values[0]
        break
      }
      case 'setlinecap':
      case 'J': {
        const values = this.takeNumbers(1)
        if (values && [0, 1, 2].includes(values[0])) this.graphics.lineCap = values[0]
        break
      }
      case 'setlinejoin':
      case 'j': {
        const values = this.takeNumbers(1)
        if (values && [0, 1, 2].includes(values[0])) this.graphics.lineJoin = values[0]
        break
      }
      case 'setmiterlimit':
      case 'M': {
        const values = this.takeNumbers(1)
        if (values && values[0] > 0) this.graphics.miterLimit = values[0]
        break
      }
      case 'setdash':
      case 'd': {
        const offset = this.takeNumbers(1)
        if (!offset) break
        const dashArray = this.takeArray()
        if (!dashArray) break
        const values = dashArray.filter((value) => typeof value === 'number' && Number.isFinite(value))
        if (values.some((value) => value < 0)) {
          this.diagnose('INVALID_DASH', '虚线数组包含负值', DiagnosticSeverity.WARNING)
          break
        }
        this.graphics.dashArray = values
        this.graphics.dashOffset = offset[0]
        break
      }

      // ---------- 状态与变换 ----------
      case 'gsave':
      case 'q':
        this.stateStack.push(this.graphics.clone())
        break
      case 'grestore':
      case 'Q':
        if (this.stateStack.length === 0) {
          this.diagnose('GRAPHICS_STATE_UNDERFLOW', 'grestore/Q 没有对应的 gsave/q', DiagnosticSeverity.WARNING)
        } else {
          this.graphics = this.stateStack.pop()
        }
        break
      case 'translate': {
        const values = this.takeNumbers(2)
        if (values) this.graphics.ctm = concatMatrix(this.graphics.ctm, translationMatrix(values[0], values[1]))
        break
      }
      case 'scale': {
        const values = this.takeNumbers(2)
        if (values) this.graphics.ctm = concatMatrix(this.graphics.ctm, scalingMatrix(values[0], values[1]))
        break
      }
      case 'rotate': {
        const values = this.takeNumbers(1)
        if (values) this.graphics.ctm = concatMatrix(this.graphics.ctm, rotationMatrix(values[0]))
        break
      }
      case 'concat':
      case 'cm': {
        const values = this.takeNumbers(6)
        if (values) this.graphics.ctm = multiplyMatrix(values, this.graphics.ctm)
        break
      }

      // ---------- 栈与算术 ----------
      case 'add': {
        const values = this.takeNumbers(2)
        if (values) this.push(values[0] + values[1])
        break
      }
      case 'sub': {
        const values = this.takeNumbers(2)
        if (values) this.push(values[0] - values[1])
        break
      }
      case 'mul': {
        const values = this.takeNumbers(2)
        if (values) this.push(values[0] * values[1])
        break
      }
      case 'div': {
        const values = this.takeNumbers(2)
        if (values) {
          if (values[1] === 0) this.diagnose('DIVISION_BY_ZERO', 'div 除数为 0', DiagnosticSeverity.WARNING)
          else this.push(values[0] / values[1])
        }
        break
      }
      case 'idiv': {
        const values = this.takeNumbers(2)
        if (values) {
          if (values[1] === 0) this.diagnose('DIVISION_BY_ZERO', 'idiv 除数为 0', DiagnosticSeverity.WARNING)
          else this.push(Math.trunc(values[0] / values[1]))
        }
        break
      }
      case 'mod': {
        const values = this.takeNumbers(2)
        if (values) {
          if (values[1] === 0) this.diagnose('DIVISION_BY_ZERO', 'mod 除数为 0', DiagnosticSeverity.WARNING)
          else this.push(values[0] % values[1])
        }
        break
      }
      case 'neg': {
        const values = this.takeNumbers(1)
        if (values) this.push(-values[0])
        break
      }
      case 'dup': {
        if (this.stack.length === 0) {
          this.diagnose('STACK_UNDERFLOW', 'dup 需要至少一个操作数', DiagnosticSeverity.WARNING)
        } else {
          this.push(this.stack[this.stack.length - 1])
        }
        break
      }
      case 'pop':
        if (this.stack.length === 0) {
          this.diagnose('STACK_UNDERFLOW', 'pop 需要至少一个操作数', DiagnosticSeverity.WARNING)
        } else {
          this.pop()
        }
        break
      case 'exch': {
        if (this.stack.length < 2) {
          this.diagnose('STACK_UNDERFLOW', 'exch 需要两个操作数', DiagnosticSeverity.WARNING)
        } else {
          const last = this.stack.length - 1
          ;[this.stack[last], this.stack[last - 1]] = [this.stack[last - 1], this.stack[last]]
        }
        break
      }
      case 'copy': {
        const count = this.takeNumbers(1)
        if (count) {
          const amount = Math.trunc(count[0])
          if (amount < 0 || this.stack.length < amount) {
            this.diagnose('STACK_UNDERFLOW', 'copy 操作数不足', DiagnosticSeverity.WARNING)
          } else {
            this.stack.push(...this.stack.slice(-amount))
          }
        }
        break
      }
      case 'index': {
        const count = this.takeNumbers(1)
        if (count) {
          const index = Math.trunc(count[0])
          if (index < 0 || index >= this.stack.length) {
            this.diagnose('STACK_UNDERFLOW', 'index 索引越界', DiagnosticSeverity.WARNING)
          } else {
            this.push(this.stack[this.stack.length - 1 - index])
          }
        }
        break
      }
      case 'clear':
        this.stack.length = 0
        break

      // ---------- 定义类：安全跳过 ----------
      case 'def':
        this.recordFeature('definition', 'def 不执行，仅移除操作数')
        if (this.stack.length >= 2) this.stack.length -= 2
        break
      case 'bind':
        this.recordFeature('bind', 'bind 不求值')
        break
      case 'dict': {
        const values = this.takeNumbers(1)
        if (values) this.push({ __dict: true })
        break
      }
      case 'begin':
      case 'end':
        this.recordFeature('dictionary-stack', '字典栈操作不执行')
        break
      case 'currentdict':
        this.push({ __dict: true })
        break

      default:
        this.recordUnknownOperator(operator, token)
        this.stats.operatorsSkipped += 1
    }
  }

  recordUnsupportedCollections(operator) {
    for (const [feature, operators] of Object.entries(UNSUPPORTED_COLLECTIONS)) {
      if (operators.has(operator)) {
        this.recordFeature(feature, `未处理的操作符：${operator}`)
        if (feature === 'text') this.stats.textOperators += 1
        if (feature === 'image') this.stats.imageOperators += 1
        if (feature === 'graphicsState') this.stats.graphicsStateOperators += 1
        return
      }
    }
  }

  recordUnknownOperator(operator, token) {
    const existing = this.unknownOperators.get(operator)
    if (existing) {
      existing.count += 1
      return
    }
    if (this.unknownOperators.size >= this.options.maxUnknownOperators) return
    this.unknownOperators.set(operator, {
      operator,
      count: 1,
      firstOffset: token.offset,
      firstLine: token.line,
    })
  }

  startSubpath(x, y) {
    if (this.pathDisabled) return
    const subpath = { closed: false, segments: [{ type: 'M', x, y }] }
    this.subpaths.push(subpath)
    this.currentSubpath = subpath
    this.currentPoint = { x, y }
    this.pointCount += 1
  }

  ensureCurrentSubpath() {
    if (this.pathDisabled) return false
    if (!this.currentSubpath) {
      this.diagnose(
        'PATH_WITHOUT_MOVETO',
        '在 moveto 之前出现路径操作，已跳过',
        DiagnosticSeverity.WARNING,
      )
      return false
    }
    return true
  }

  appendLine(x, y) {
    if (!this.ensureCurrentSubpath()) return
    if (this.pointCount >= this.options.maxPoints) return this.disablePath('point-limit')
    this.currentSubpath.segments.push({ type: 'L', x, y })
    this.currentPoint = { x, y }
    this.pointCount += 1
  }

  appendCurve(x1, y1, x2, y2, x, y) {
    if (!this.ensureCurrentSubpath()) return
    if (this.pointCount + 3 > this.options.maxPoints) return this.disablePath('point-limit')
    this.currentSubpath.segments.push({ type: 'C', x1, y1, x2, y2, x, y })
    this.currentPoint = { x, y }
    this.pointCount += 3
  }

  closeSubpath() {
    if (!this.currentSubpath) return
    this.currentSubpath.closed = true
    this.currentSubpath = null
  }

  closeAllSubpaths() {
    for (const subpath of this.subpaths) subpath.closed = true
    this.currentSubpath = null
  }

  appendRectangle(x, y, width, height) {
    if (this.pathDisabled) return
    if (this.pointCount + 4 > this.options.maxPoints) return this.disablePath('point-limit')
    this.subpaths.push({
      closed: true,
      segments: [
        { type: 'M', x, y },
        { type: 'L', x: x + width, y },
        { type: 'L', x: x + width, y: y + height },
        { type: 'L', x, y: y + height },
      ],
    })
    this.currentSubpath = null
    this.currentPoint = { x, y }
    this.pointCount += 4
  }

  disablePath(reason) {
    if (!this.pathDisabled) {
      this.pathDisabled = true
      this.truncated = true
      this.truncatedReason = this.truncatedReason ?? reason
      this.diagnose(
        'PATH_LIMIT',
        '路径点数超过安全上限，后续路径绘制被截断',
        DiagnosticSeverity.WARNING,
      )
    }
    this.resetPath()
  }

  resetPath() {
    this.subpaths = []
    this.currentSubpath = null
    this.currentPoint = null
  }

  paint(options) {
    if (this.subpaths.length === 0) {
      this.resetPath()
      return
    }

    const graphics = this.graphics
    const object = this.builder.addPath({
      subpaths: this.subpaths,
      fill: options.fill ? clonePaint(graphics.fillColor) : null,
      stroke: options.stroke ? clonePaint(graphics.strokeColor) : null,
      fillRule: options.fillRule,
      transform: [...graphics.ctm],
      strokeWidth: graphics.lineWidth,
      lineCap: graphics.lineCap,
      lineJoin: graphics.lineJoin,
      miterLimit: graphics.miterLimit,
      dashArray: graphics.dashArray,
      dashOffset: graphics.dashOffset,
    })

    if (object) this.stats.paintedObjects += 1
    else this.stats.suppressedPaths += 1

    this.resetPath()
  }
}

/**
 * 便捷入口。
 * @param {string} source
 * @param {{ mode?: string, source?: string, artboardHints?: object[], maxTokens?: number }} [options]
 */
export function parsePostScript(source, options = {}) {
  return new PostScriptParser(options).parse(source, options)
}
