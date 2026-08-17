/**
 * 异步请求所有权原语。
 *
 * 调用方可以让多个请求并行，但只有最新 generation 的响应有权提交状态。
 * 旧响应仍可由调用方读取作诊断，不会被这里隐式 abort 或吞掉。
 */
export function createLatestRequestGate() {
  let generation = 0;
  return Object.freeze({
    begin() {
      generation += 1;
      return generation;
    },
    isCurrent(token) {
      return token === generation;
    },
    invalidate() {
      generation += 1;
      return generation;
    },
  });
}
