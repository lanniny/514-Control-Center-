/**
 * 带行号的代码编辑组件（无依赖）：textarea + 行号 gutter。
 *
 * 用法：HTML 静态标记为
 *   <div class="json-editor">
 *     <div class="json-editor-gutter" aria-hidden="true"></div>
 *     <textarea ...></textarea>
 *   </div>
 * 然后 attachJsonEditor(wrapper) 接线。行号随 input/scroll 同步；
 * 程序化改写 textarea.value 后调用返回句柄的 sync() 刷新行号。
 */

export function attachJsonEditor(wrapper) {
  const gutter = wrapper?.querySelector(".json-editor-gutter");
  const textarea = wrapper?.querySelector("textarea");
  if (!gutter || !textarea) return null;
  let renderedLines = 0;
  const sync = () => {
    const lines = textarea.value === "" ? 1 : textarea.value.split("\n").length;
    if (renderedLines !== lines) {
      renderedLines = lines;
      let numbers = "";
      for (let index = 1; index <= lines; index += 1) numbers += `${index}\n`;
      gutter.textContent = numbers;
    }
    gutter.scrollTop = textarea.scrollTop;
  };
  textarea.addEventListener("input", sync);
  textarea.addEventListener("scroll", () => {
    gutter.scrollTop = textarea.scrollTop;
  }, { passive: true });
  sync();
  return { sync };
}
