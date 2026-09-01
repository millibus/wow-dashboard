// DOM construction layer. ALL dynamic data flows through textContent,
// setAttribute, or dataset — never innerHTML / insertAdjacentHTML. This is the
// only module that builds elements; keeping the rule here keeps it everywhere.

// el('div', { class: 'x', text: name, dataset: {...}, onclick: fn }, ...children)
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'text') node.textContent = String(value);
    else if (key === 'class') node.className = value;
    else if (key === 'dataset') for (const [k, v] of Object.entries(value)) node.dataset[k] = v;
    else if (key === 'style') for (const [k, v] of Object.entries(value)) node.style.setProperty(k, v);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'src' || key === 'href') setSafeUrl(node, key, value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

// URLs originating from API data are only ever assigned if they parse as
// http(s) or are relative — a hostile `javascript:` value becomes a no-op.
function setSafeUrl(node, attr, value) {
  try {
    const url = new URL(value, document.baseURI);
    if (url.protocol === 'https:' || url.protocol === 'http:') node.setAttribute(attr, url.href);
  } catch (_) { /* unparsable — drop it */ }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// Static icon builder: `paths` are hardcoded literals from our own modules,
// never API data.
export function icon(paths, { size = 16, viewBox = '0 0 24 24' } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}
