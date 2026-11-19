/**
 * TextRenderer
 * ----------------
 * 文字对象尚未进入 Scene Graph（阶段 3 只处理轮廓路径）。
 * 保留接口，后续实现时只消费 Scene Graph Text 节点，不解析 AI 文本数据。
 */

/**
 * @returns {false} 当前阶段不渲染文字
 */
export function renderText() {
  return false
}
