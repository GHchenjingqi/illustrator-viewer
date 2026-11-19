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
export { extractAi24Zstd } from './core/AI24Extractor.js'
export { extractNativeArtboards } from './core/AIArtboardExtractor.js'
export { extractGradientDefinitions } from './core/AIGradientExtractor.js'
export { buildScene, cmykToRgb } from './scene/SceneBuilder.js'
export { CanvasRenderer, computeViewport, screenToWorld, worldToScreen } from './renderer/CanvasRenderer.js'
export { buildPath2D, buildCompoundPath2D } from './renderer/PathRenderer.js'
export { resolvePaintColor } from './engine/ColorEngine.js'
export { WasmBridge } from './wasm/WasmBridge.js'
export { loadWasmModule, clearWasmCache } from './wasm/WasmLoader.js'
export { decompressZstd } from './utils/zstd.js'
export { decodeLatin1, decodeMaybeUtf8 } from './utils/encoding.js'
export {
  AiViewerError,
  ErrorCodes,
  DiagnosticSeverity,
  createDiagnostic,
  toDiagnosticError,
} from './utils/errors.js'
