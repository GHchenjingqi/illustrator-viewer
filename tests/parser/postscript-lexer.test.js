import { describe, expect, it } from 'vitest'
import { PostScriptLexer, PostScriptTokenType, tokenizePostScript } from '../../src/core/PostScriptLexer.js'

describe('PostScriptLexer', () => {
  it('切分数字、名字、字符串与操作符', () => {
    const result = tokenizePostScript('0 -12.5 .25 1e3 /DeviceRGB /Cs1 2#FF (hello) m l')
    const values = result.tokens.map((token) => [token.type, token.value])
    expect(values).toEqual([
      [PostScriptTokenType.NUMBER, 0],
      [PostScriptTokenType.NUMBER, -12.5],
      [PostScriptTokenType.NUMBER, 0.25],
      [PostScriptTokenType.NUMBER, 1000],
      [PostScriptTokenType.NAME, 'DeviceRGB'],
      [PostScriptTokenType.NAME, 'Cs1'],
      [PostScriptTokenType.NUMBER, 2],
      [PostScriptTokenType.OPERATOR, '#FF'],
      [PostScriptTokenType.STRING, 'hello'],
      [PostScriptTokenType.OPERATOR, 'm'],
      [PostScriptTokenType.OPERATOR, 'l'],
    ])
  })

  it('处理注释、换行与行号', () => {
    const result = tokenizePostScript('% 注释\n0 0 m % 行尾注释\n100 0 l')
    expect(result.tokens.map((token) => token.value)).toEqual([0, 0, 'm', 100, 0, 'l'])
    expect(result.tokens[0].line).toBe(2)
    expect(result.tokens[3].line).toBe(3)
  })

  it('兼容 CR-only 换行（AI 私有数据常见）', () => {
    const result = tokenizePostScript('% 注释\r0 0 m % 行尾注释\r100 0 l\r')
    expect(result.tokens.map((token) => token.value)).toEqual([0, 0, 'm', 100, 0, 'l'])
    expect(result.tokens[0].line).toBe(2)
  })

  it('解析转义字符串与嵌套括号', () => {
    const result = tokenizePostScript('(a\\n(b)c\\(d\\)\\101)')
    expect(result.tokens[0].value).toBe('a\n(b)c(d)A')
  })

  it('解析十六进制字符串', () => {
    const result = tokenizePostScript('<414243> <4 1 4 2 4 3 4 4>')
    expect(result.tokens.map((token) => token.value)).toEqual(['ABC', 'ABCD'])
    expect(result.tokens[0].type).toBe(PostScriptTokenType.HEX_STRING)
  })

  it('识别数组、字典与过程边界', () => {
    const result = tokenizePostScript('[1 2 [3]] << /A 1 >> { 1 2 add }')
    const types = result.tokens.map((token) => token.type)
    expect(types).toContain(PostScriptTokenType.ARRAY_START)
    expect(types).toContain(PostScriptTokenType.ARRAY_END)
    expect(types).toContain(PostScriptTokenType.DICT_START)
    expect(types).toContain(PostScriptTokenType.DICT_END)
    expect(types).toContain(PostScriptTokenType.BRACE_START)
    expect(types).toContain(PostScriptTokenType.BRACE_END)
  })

  it('布尔值单独识别', () => {
    const result = tokenizePostScript('true false')
    expect(result.tokens.map((token) => [token.type, token.value])).toEqual([
      [PostScriptTokenType.BOOLEAN, true],
      [PostScriptTokenType.BOOLEAN, false],
    ])
  })

  it('未闭合字符串产生诊断但不抛异常', () => {
    const result = tokenizePostScript('(unclosed')
    expect(result.tokens[0].value).toBe('unclosed')
    expect(result.diagnostics.some((item) => item.code === 'UNTERMINATED_STRING')).toBe(true)
  })

  it('遵守 token 数量上限', () => {
    const lexer = new PostScriptLexer('1 2 3 4 5 6', { maxTokens: 3 })
    const result = lexer.tokenize()
    expect(result.tokenCount).toBe(3)
    expect(result.truncated).toBe(true)
    expect(result.diagnostics.some((item) => item.code === 'TOKEN_LIMIT')).toBe(true)
  })

  it('跳过 %%BeginData 二进制块', () => {
    const source = '%%BeginData: 4\r\n\u0000\u0001\u0002\u0003\r\n%%EndData\r\n0 0 m 10 0 l'
    const result = tokenizePostScript(source)
    expect(result.tokens.map((token) => token.value)).toEqual([0, 0, 'm', 10, 0, 'l'])
    expect(result.diagnostics.some((item) => item.code === 'BINARY_DATA_SKIPPED')).toBe(true)
  })
})
