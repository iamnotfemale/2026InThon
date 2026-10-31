import { h, Component } from './vendor/preact.module.js';

const token = /^\s*{{\s*([\w.]+)\s*}}\s*$/;
const lookup = (scope, path) => path === 'true' ? true : path === 'false' ? false
  : path.split('.').reduce((value, key) => value?.[key], scope);
const bind = (value, scope) => token.test(value) ? lookup(scope, token.exec(value)[1])
  : value.replace(/{{\s*([\w.]+)\s*}}/g, (_, path) => String(lookup(scope, path) ?? ''));

export function renderNodes(nodes, scope, state, prefix = '') {
  return nodes.map(node => {
    if (typeof node === 'string') return bind(node, scope) ?? '';
    if (node.tag === 'sc-if') return bind(node.attrs.value, scope) ? renderNodes(node.children, scope, state, prefix) : null;
    if (node.tag === 'sc-scope') return renderNodes(node.children, { ...scope, ...bind(node.attrs.value, scope) }, state, prefix);
    if (node.tag === 'sc-for') {
      const list = bind(node.attrs.list, scope) ?? [];
      return list.map((item, index) => renderNodes(node.children, { ...scope, [node.attrs.as]: item }, state,
        `${prefix}/${node.id}:${item?.id ?? item?.k ?? index}`));
    }
    const props = { key: prefix + '/' + node.id };
    for (const [name, value] of Object.entries(node.attrs)) {
      const resolved = bind(value, scope);
      if (name === 'onclick' || name === 'onchange') {
        const event = name === 'onclick' ? 'onClick'
          : node.tag === 'input' && !['checkbox', 'radio'].includes(node.attrs.type) ? 'onInput' : 'onChange';
        if (typeof resolved === 'function') props[event] = resolved;
      } else if (['checked', 'disabled', 'selected', 'multiple', 'hidden', 'readonly'].includes(name)) {
        props[name] = token.test(value) ? resolved === true || resolved === 'true' : true;
      } else if (resolved !== undefined && resolved !== null) props[name] = resolved;
    }
    if (String(props.class).split(' ').includes('enter')) props.key += `:${state.view}:${state.detailId ?? ''}`;
    if (String(props.class).split(' ').includes('cook-pane')) props.key += `:${state.cook?.stage}:${state.cook?.idx}`;
    return h(node.tag, props, renderNodes(node.children, scope, state, prefix));
  });
}

export class DCLogic extends Component {
  render() { return renderNodes(this.props.template, this.renderVals(), this.state); }
}
