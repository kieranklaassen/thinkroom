import clsx from 'clsx';
import DOMPurify from 'dompurify';
import { h } from 'vue';

function keepAlive(..._args) {
}

keepAlive(h);
function Icon({ icon, class: className, onClick }) {
  return /* @__PURE__ */ h(
    "span",
    {
      class: clsx("milkdown-icon", className),
      onPointerdown: onClick,
      innerHTML: icon ? DOMPurify.sanitize(icon.trim()) : void 0
    }
  );
}
Icon.props = {
  icon: {
    type: String,
    required: false
  },
  class: {
    type: String,
    required: false
  },
  onClick: {
    type: Function,
    required: false
  }
};

export { Icon };
//# sourceMappingURL=index.js.map
