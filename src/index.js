/**
 * AI Viewer Engine 公共导出。
 * 阶段 1 仅暴露结构检测相关能力；后续阶段在此追加解析/渲染接口。
 */

export {
  AIParserEngine,
  ENGINE_STAGE,
  ENGINE_VERSION,
} from './core/AIParserEngine.js'
export { AIFileReader, DEFAULT_MAX_FILE_SIZE, DEFAULT_CHUNK_SIZE } from './core/AIFileReader.js'
export {
  detectStructure,
  MARKER_DEFINITIONS,
  ContainerKind,
} from './core/AIFileDetector.js'
export {
  BinaryParser,
  decodeAscii85,
  inflateBytes,
  indexOfBytes,
  looksLikeZlib,
  looksLikeZstandard,
  toUint8Array,
} from './core/BinaryParser.js'
export {
  PostScriptLexer,
  PostScriptTokenType,
  tokenizePostScript,
} from './core/PostScriptLexer.js'
export { PostScriptParser, parsePostScript } from './core/PostScriptParser.js'
export { PostScriptGraphicsState } from './core/PostScriptGraphicsState.js'
export { VectorBuilder, computeBounds, normalizePaint } from './core/VectorParser.js'
export { extractPageBoxes, pageBoxesToArtboards } from './core/PageBoxExtractor.js'
export {
  IDENTITY_MATRIX,
  concatMatrix,
  matrixToObject,
  multiplyMatrix,
  rotationMatrix,
  scalingMatrix,
  transformPoint,
  translationMatrix,
} from './engine/TransformEngine.js'
export { buildCompatibilityReport, SupportLevel } from './engine/CompatibilityEngine.js'
export {
  AiViewerError,
  ErrorCodes,
  DiagnosticSeverity,
  createDiagnostic,
  toDiagnosticError,
} from './utils/errors.js'
