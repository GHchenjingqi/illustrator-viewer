/**
 * PostScriptLexer
 * ----------------
 * 将 PostScript / Illustrator 私有数据（已解码文本）切分为 token。
 *
 * 仅做词法分析，不执行任何代码。支持：
 * - 数字、名字（/Name、//Name）、字符串、十六进制字符串
 * - 注释（% 到行尾）
 * - 数组 [ ]、字典 << >>、过程 { }
 * - 布尔值、操作符
 *
 * 对未闭合字符串、非法十六进制等输入输出诊断并尽量继续。
 */

import { createDiagnostic, DiagnosticSeverity } from '../utils/errors.js'

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20])
const DELIMITERS = new Set([
  0x28, // (
  0x29, // )
  0x3c, // <
  0x3e, // >
  0x5b, // [
  0x5d, // ]
  0x7b, // {
  0x7d, // }
  0x2f, // /
  0x25, // %
])

const NUMBER_PATTERN = /^[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?/

export const PostScriptTokenType = Object.freeze({
  NUMBER: 'number',
  NAME: 'name',
  STRING: 'string',
  HEX_STRING: 'hex-string',
  BOOLEAN: 'boolean',
  OPERATOR: 'operator',
  ARRAY_START: 'array-start',
  ARRAY_END: 'array-end',
  DICT_START: 'dict-start',
  DICT_END: 'dict-end',
  BRACE_START: 'brace-start',
  BRACE_END: 'brace-end',
})

export class PostScriptLexer {
  /**
   * @param {string} source
   * @param {{ maxTokens?: number }} [options]
   */
  constructor(source, options = {}) {
    if (typeof source !== 'string') {
      throw new TypeError('PostScriptLexer 需要字符串输入')
    }
    this.source = source
    this.length = source.length
    this.offset = 0
    this.line = 1
    this.maxTokens = options.maxTokens ?? 200000
    this.diagnostics = []
  }

  tokenize() {
    const tokens = []
    let truncated = false

    while (this.offset < this.length) {
      if (tokens.length >= this.maxTokens) {
        truncated = true
        this.diagnostics.push(
          createDiagnostic(
            'TOKEN_LIMIT',
            `token 数量超过上限 ${this.maxTokens}，词法分析已截断`,
            DiagnosticSeverity.WARNING,
            { offset: this.offset, maxTokens: this.maxTokens },
          ),
        )
        break
      }

      const code = this.source.charCodeAt(this.offset)
      if (WHITESPACE.has(code)) {
        if (code === 0x0a) this.line += 1
        this.offset += 1
        continue
      }

      if (code === 0x25) {
        if (this.source.startsWith('%%BeginData', this.offset)) {
          const endMarker = this.source.indexOf('%%EndData', this.offset)
          if (endMarker > 0) {
            const endLine = this.source.indexOf('\n', endMarker)
            const nextOffset = endLine < 0 ? this.length : endLine + 1
            const startOffset = this.offset
            this.line += this.countNewlines(startOffset, nextOffset)
            this.offset = nextOffset
            this.diagnostics.push(
              createDiagnostic(
                'BINARY_DATA_SKIPPED',
                `已跳过二进制数据块（${nextOffset - startOffset} 字节）`,
                DiagnosticSeverity.INFO,
                { offset: startOffset, bytes: nextOffset - startOffset },
              ),
            )
            continue
          }
        }
        this.skipComment()
        continue
      }

      const start = this.offset
      const startLine = this.line

      if (code === 0x28) {
        tokens.push({
          type: PostScriptTokenType.STRING,
          value: this.readString(),
          offset: start,
          line: startLine,
        })
        continue
      }

      if (code === 0x3c) {
        if (this.source.charCodeAt(this.offset + 1) === 0x3c) {
          this.offset += 2
          tokens.push({ type: PostScriptTokenType.DICT_START, value: '<<', offset: start, line: startLine })
        } else {
          tokens.push({
            type: PostScriptTokenType.HEX_STRING,
            value: this.readHexString(),
            offset: start,
            line: startLine,
          })
        }
        continue
      }

      if (code === 0x3e) {
        if (this.source.charCodeAt(this.offset + 1) === 0x3e) {
          this.offset += 2
          tokens.push({ type: PostScriptTokenType.DICT_END, value: '>>', offset: start, line: startLine })
        } else {
          this.offset += 1
          tokens.push({ type: PostScriptTokenType.OPERATOR, value: '>', offset: start, line: startLine })
          this.diagnostics.push(
            createDiagnostic('UNEXPECTED_DELIMITER', '发现孤立的 > 符号', DiagnosticSeverity.INFO, {
              offset: start,
            }),
          )
        }
        continue
      }

      if (code === 0x5b) {
        this.offset += 1
        tokens.push({ type: PostScriptTokenType.ARRAY_START, value: '[', offset: start, line: startLine })
        continue
      }
      if (code === 0x5d) {
        this.offset += 1
        tokens.push({ type: PostScriptTokenType.ARRAY_END, value: ']', offset: start, line: startLine })
        continue
      }
      if (code === 0x7b) {
        this.offset += 1
        tokens.push({ type: PostScriptTokenType.BRACE_START, value: '{', offset: start, line: startLine })
        continue
      }
      if (code === 0x7d) {
        this.offset += 1
        tokens.push({ type: PostScriptTokenType.BRACE_END, value: '}', offset: start, line: startLine })
        continue
      }

      if (code === 0x29 || code === 0x3e) {
        this.offset += 1
        tokens.push({ type: PostScriptTokenType.OPERATOR, value: String.fromCharCode(code), offset: start, line: startLine })
        continue
      }

      if (code === 0x2f) {
        this.offset += 1
        let immediate = false
        if (this.source.charCodeAt(this.offset) === 0x2f) {
          immediate = true
          this.offset += 1
        }
        const nameStart = this.offset
        while (this.offset < this.length) {
          const next = this.source.charCodeAt(this.offset)
          if (WHITESPACE.has(next) || DELIMITERS.has(next)) break
          this.offset += 1
        }
        tokens.push({
          type: PostScriptTokenType.NAME,
          value: this.source.slice(nameStart, this.offset),
          immediate,
          offset: start,
          line: startLine,
        })
        continue
      }

      const numberMatch = NUMBER_PATTERN.exec(this.source.slice(this.offset, this.offset + 64))
      if (numberMatch) {
        const raw = numberMatch[0]
        this.offset += raw.length
        tokens.push({
          type: PostScriptTokenType.NUMBER,
          value: Number(raw),
          raw,
          offset: start,
          line: startLine,
        })
        continue
      }

      // 普通操作符
      const operatorStart = this.offset
      while (this.offset < this.length) {
        const next = this.source.charCodeAt(this.offset)
        if (WHITESPACE.has(next) || DELIMITERS.has(next)) break
        this.offset += 1
      }

      if (this.offset === operatorStart) {
        // 理论上不会发生，避免死循环
        this.offset += 1
        continue
      }

      const value = this.source.slice(operatorStart, this.offset)
      if (value === 'true' || value === 'false') {
        tokens.push({
          type: PostScriptTokenType.BOOLEAN,
          value: value === 'true',
          offset: start,
          line: startLine,
        })
      } else {
        tokens.push({
          type: PostScriptTokenType.OPERATOR,
          value,
          offset: start,
          line: startLine,
        })
      }
    }

    return {
      tokens,
      truncated,
      tokenCount: tokens.length,
      diagnostics: this.diagnostics,
    }
  }

  skipComment() {
    while (this.offset < this.length) {
      const code = this.source.charCodeAt(this.offset)
      this.offset += 1
      if (code === 0x0a) {
        this.line += 1
        break
      }
      if (code === 0x0d) {
        if (this.source.charCodeAt(this.offset) === 0x0a) this.offset += 1
        this.line += 1
        break
      }
    }
  }

  countNewlines(start, end) {
    let count = 0
    for (let index = start; index < end; index += 1) {
      const code = this.source.charCodeAt(index)
      if (code === 0x0a) count += 1
      else if (code === 0x0d) {
        count += 1
        if (this.source.charCodeAt(index + 1) === 0x0a) index += 1
      }
    }
    return count
  }

  readString() {
    const start = this.offset
    this.offset += 1 // (
    let depth = 1
    let result = ''

    while (this.offset < this.length) {
      const code = this.source.charCodeAt(this.offset)
      this.offset += 1

      if (code === 0x5c) {
        // 转义
        if (this.offset >= this.length) break
        const escaped = this.source.charCodeAt(this.offset)
        this.offset += 1

        if (escaped === 0x6e) result += '\n'
        else if (escaped === 0x72) result += '\r'
        else if (escaped === 0x74) result += '\t'
        else if (escaped === 0x62) result += '\b'
        else if (escaped === 0x66) result += '\f'
        else if (escaped === 0x28) result += '('
        else if (escaped === 0x29) result += ')'
        else if (escaped === 0x5c) result += '\\'
        else if (escaped === 0x0a) this.line += 1
        else if (escaped === 0x0d) {
          if (this.source.charCodeAt(this.offset) === 0x0a) this.offset += 1
          this.line += 1
        } else if (escaped >= 0x30 && escaped <= 0x37) {
          let octal = String.fromCharCode(escaped)
          for (let index = 0; index < 2; index += 1) {
            const next = this.source.charCodeAt(this.offset)
            if (next >= 0x30 && next <= 0x37) {
              octal += String.fromCharCode(next)
              this.offset += 1
            } else break
          }
          result += String.fromCharCode(parseInt(octal, 8) & 0xff)
        } else {
          result += String.fromCharCode(escaped)
        }
        continue
      }

      if (code === 0x28) {
        depth += 1
        result += '('
        continue
      }
      if (code === 0x29) {
        depth -= 1
        if (depth === 0) return result
        result += ')'
        continue
      }
      if (code === 0x0a) this.line += 1
      result += String.fromCharCode(code)
    }

    this.diagnostics.push(
      createDiagnostic('UNTERMINATED_STRING', '字符串未闭合，已读取到文件末尾', DiagnosticSeverity.WARNING, {
        offset: start,
      }),
    )
    return result
  }

  readHexString() {
    const start = this.offset
    this.offset += 1 // <
    let hex = ''

    while (this.offset < this.length) {
      const code = this.source.charCodeAt(this.offset)
      this.offset += 1
      if (code === 0x3e) {
        if (hex.length % 2 === 1) hex += '0'
        let result = ''
        for (let index = 0; index < hex.length; index += 2) {
          const byte = Number.parseInt(hex.slice(index, index + 2), 16)
          if (!Number.isFinite(byte)) {
            this.diagnostics.push(
              createDiagnostic('INVALID_HEX_STRING', '十六进制字符串包含非法字符', DiagnosticSeverity.WARNING, {
                offset: start,
              }),
            )
            continue
          }
          result += String.fromCharCode(byte)
        }
        return result
      }
      if (WHITESPACE.has(code)) {
        if (code === 0x0a) this.line += 1
        continue
      }
      const char = String.fromCharCode(code)
      if (/[0-9a-fA-F]/.test(char)) hex += char
    }

    this.diagnostics.push(
      createDiagnostic('UNTERMINATED_HEX_STRING', '十六进制字符串未闭合', DiagnosticSeverity.WARNING, {
        offset: start,
      }),
    )
    return ''
  }
}

/**
 * 便捷函数。
 * @param {string} source
 * @param {{ maxTokens?: number }} [options]
 */
export function tokenizePostScript(source, options = {}) {
  return new PostScriptLexer(source, options).tokenize()
}
