import { $ctx, $view } from '@milkdown/utils';
import { listItemSchema } from '@milkdown/preset-commonmark';
import { TextSelection } from '@milkdown/prose/state';
import { h, defineComponent, computed, ref, watchEffect, createApp } from 'vue';
import clsx from 'clsx';
import DOMPurify from 'dompurify';

var __defProp = Object.defineProperty;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
function withMeta(plugin, meta) {
  Object.assign(plugin, {
    meta: __spreadValues({
      package: "@milkdown/components"
    }, meta)
  });
  return plugin;
}

const defaultListItemBlockConfig = {
  renderLabel: ({ label, listType, checked }) => {
    const content = checked == null ? listType === "bullet" ? "\u29BF" : label : checked ? "\u2611" : "\u25A1";
    return content;
  }
};
const listItemBlockConfig = $ctx(
  defaultListItemBlockConfig,
  "listItemBlockConfigCtx"
);
withMeta(listItemBlockConfig, {
  displayName: "Config<list-item-block>",
  group: "ListItemBlock"
});

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

keepAlive(h);
const ListItem = defineComponent({
  props: {
    label: {
      type: Object,
      required: true
    },
    checked: {
      type: Object,
      required: true
    },
    listType: {
      type: Object,
      required: true
    },
    config: {
      type: Object,
      required: true
    },
    readonly: {
      type: Object,
      required: true
    },
    selected: {
      type: Object,
      required: true
    },
    setAttr: {
      type: Function,
      required: true
    },
    onMount: {
      type: Function,
      required: true
    }
  },
  setup({
    label,
    checked,
    listType,
    config,
    readonly,
    setAttr,
    onMount,
    selected
  }) {
    const contentWrapperRef = (div) => {
      if (div == null) return;
      if (div instanceof Element) {
        onMount(div);
      }
    };
    const onClickLabel = (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (checked.value == null) return;
      setAttr("checked", !checked.value);
    };
    const icon = computed(() => {
      return config.renderLabel({
        label: label.value,
        listType: listType.value,
        checked: checked.value,
        readonly: readonly.value
      });
    });
    const labelClass = computed(() => {
      if (checked.value == null) {
        if (listType.value === "bullet") return "bullet";
        return "ordered";
      }
      if (checked.value) return "checked";
      return "unchecked";
    });
    return () => {
      return /* @__PURE__ */ h(
        "li",
        {
          class: clsx(
            "list-item",
            selected.value && "ProseMirror-selectednode"
          )
        },
        /* @__PURE__ */ h(
          "div",
          {
            class: "label-wrapper",
            onPointerdown: onClickLabel,
            contenteditable: false
          },
          /* @__PURE__ */ h(
            Icon,
            {
              class: clsx(
                "label",
                readonly.value && "readonly",
                labelClass.value
              ),
              icon: icon.value
            }
          )
        ),
        /* @__PURE__ */ h("div", { class: "children", ref: contentWrapperRef })
      );
    };
  }
});

const listItemBlockView = $view(
  listItemSchema.node,
  (ctx) => {
    return (initialNode, view, getPos) => {
      const dom = document.createElement("div");
      dom.className = "milkdown-list-item-block";
      const contentDOM = document.createElement("div");
      contentDOM.setAttribute("data-content-dom", "true");
      contentDOM.classList.add("content-dom");
      const label = ref(initialNode.attrs.label);
      const checked = ref(initialNode.attrs.checked);
      const listType = ref(initialNode.attrs.listType);
      const readonly = ref(!view.editable);
      const config = ctx.get(listItemBlockConfig.key);
      const selected = ref(false);
      const setAttr = (attr, value) => {
        if (!view.editable) return;
        const pos = getPos();
        if (pos == null) return;
        if (!view.hasFocus()) view.focus();
        view.dispatch(view.state.tr.setNodeAttribute(pos, attr, value));
      };
      const disposeSelectedWatcher = watchEffect(() => {
        const isSelected = selected.value;
        if (isSelected) {
          dom.classList.add("selected");
        } else {
          dom.classList.remove("selected");
        }
      });
      let raf = 0;
      const onMount = (div) => {
        const { anchor, head } = view.state.selection;
        div.appendChild(contentDOM);
        const anchorPos = view.state.doc.resolve(anchor);
        const headPos = view.state.doc.resolve(head);
        raf = requestAnimationFrame(() => {
          cancelAnimationFrame(raf);
          if (!anchorPos.doc.eq(view.state.doc)) return;
          const selection = new TextSelection(anchorPos, headPos);
          view.dispatch(view.state.tr.setSelection(selection));
        });
      };
      const app = createApp(ListItem, {
        label,
        checked,
        listType,
        readonly,
        config,
        selected,
        setAttr,
        onMount
      });
      app.mount(dom);
      const bindAttrs = (node2) => {
        listType.value = node2.attrs.listType;
        label.value = node2.attrs.label;
        checked.value = node2.attrs.checked;
        readonly.value = !view.editable;
      };
      bindAttrs(initialNode);
      let node = initialNode;
      return {
        dom,
        contentDOM,
        update: (updatedNode) => {
          if (updatedNode.type !== initialNode.type) return false;
          if (updatedNode.sameMarkup(node) && updatedNode.content.eq(node.content))
            return true;
          node = updatedNode;
          bindAttrs(updatedNode);
          return true;
        },
        ignoreMutation: (mutation) => {
          if (!dom || !contentDOM) return true;
          if (mutation.type === "selection") return false;
          if (contentDOM === mutation.target && mutation.type === "attributes")
            return true;
          if (contentDOM.contains(mutation.target)) return false;
          return true;
        },
        selectNode: () => {
          selected.value = true;
        },
        deselectNode: () => {
          selected.value = false;
        },
        destroy: () => {
          disposeSelectedWatcher();
          app.unmount();
          dom.remove();
          contentDOM.remove();
        }
      };
    };
  }
);
withMeta(listItemBlockView, {
  displayName: "NodeView<list-item-block>",
  group: "ListItemBlock"
});

const listItemBlockComponent = [
  listItemBlockConfig,
  listItemBlockView
];

export { ListItem, defaultListItemBlockConfig, listItemBlockComponent, listItemBlockConfig, listItemBlockView };
//# sourceMappingURL=index.js.map
