import { resolveColor, toCss, type Palette } from '../animation/color';
import type { Frame, VisualActor } from '../animation/interpolate';
import type { ActorType, CompiledAnimation } from '../scene/model';
import type { Renderer } from '../player/player';

const SVG_NS = 'http://www.w3.org/2000/svg';

interface Node {
  readonly id: string;
  readonly type: ActorType;
  readonly g: SVGGElement;
  /** shape elements, by role */
  readonly shape: SVGElement | null;
  readonly head: SVGPathElement | null;
  readonly children: string[];
  last: VisualActor | null;
}

/** Number -> attribute string. Guards against NaN/Infinity ever reaching the DOM. */
const n = (v: number): string => (Number.isFinite(v) ? String(+v.toFixed(3)) : '0');

/**
 * Renders frames as SVG in a logical coordinate system of `scene.width x scene.height` units
 * (default 1000 x 600; origin top-left, y grows downwards), scaled to fit the host via viewBox.
 *
 * Author data reaches the DOM only as numbers formatted by `n()`, resolved colors, or `textContent`.
 */
export class SvgRenderer implements Renderer {
  private svg: SVGSVGElement | null = null;
  private nodes = new Map<string, Node>();
  private roots: string[] = [];
  private order = new Map<string, number>();
  private rootG: SVGGElement | null = null;
  private bg: SVGRectElement | null = null;
  private anim: CompiledAnimation | null = null;
  private palette: Palette = {};

  constructor(private readonly host: HTMLElement) {}

  setPalette(p: Palette): void {
    this.palette = p;
    this.applyBackground();
  }

  get element(): SVGSVGElement | null { return this.svg; }

  setAnimation(anim: CompiledAnimation): void {
    this.clear();
    this.anim = anim;
    const doc = this.host.ownerDocument;
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${anim.width} ${anim.height}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('class', 'ponder-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', anim.description ? `${anim.title}. ${anim.description}` : anim.title);
    this.bg = doc.createElementNS(SVG_NS, 'rect');
    this.bg.setAttribute('width', String(anim.width));
    this.bg.setAttribute('height', String(anim.height));
    svg.appendChild(this.bg);
    this.rootG = doc.createElementNS(SVG_NS, 'g');
    svg.appendChild(this.rootG);

    anim.actorOrder.forEach((id, i) => this.order.set(id, i));
    for (const id of anim.actorOrder) {
      const meta = anim.meta.get(id)!;
      const g = doc.createElementNS(SVG_NS, 'g');
      let shape: SVGElement | null = null;
      let head: SVGPathElement | null = null;
      switch (meta.type) {
        case 'rectangle': shape = doc.createElementNS(SVG_NS, 'rect'); break;
        case 'circle': shape = doc.createElementNS(SVG_NS, 'circle'); break;
        case 'ellipse': shape = doc.createElementNS(SVG_NS, 'ellipse'); break;
        case 'text': shape = doc.createElementNS(SVG_NS, 'text'); break;
        case 'polygon': shape = doc.createElementNS(SVG_NS, 'polygon'); break;
        case 'line':
        case 'arrow':
          shape = doc.createElementNS(SVG_NS, 'line');
          shape.setAttribute('stroke-linecap', 'butt');
          if (meta.type === 'arrow') {
            head = doc.createElementNS(SVG_NS, 'path');
            head.setAttribute('stroke-linejoin', 'miter');
          }
          break;
        case 'group': break;
      }
      if (shape) {
        if (meta.type === 'text') {
          shape.setAttribute('dominant-baseline', 'central');
          shape.setAttribute('class', 'ponder-text');
        }
        if (meta.type === 'polygon') shape.setAttribute('stroke-linejoin', 'miter');
        g.appendChild(shape);
      }
      if (head) g.appendChild(head);
      const node: Node = { id, type: meta.type, g, shape, head, children: [], last: null };
      this.nodes.set(id, node);
      if (meta.parent) this.nodes.get(meta.parent)!.children.push(id);
      else this.roots.push(id);
    }
    this.applyBackground();
    this.host.appendChild(svg);
    this.svg = svg;
  }

  render(frame: Frame): void {
    if (!this.rootG) return;
    let zChanged = false;
    for (const [id, a] of frame) {
      const node = this.nodes.get(id);
      if (!node || node.last === a) continue;
      if (node.last && node.last.z !== a.z) zChanged = true;
      if (!node.last) zChanged = true;
      this.apply(node, a);
      node.last = a;
    }
    if (zChanged) this.reorder(frame);
  }

  destroy(): void {
    this.clear();
  }


  private clear(): void {
    this.svg?.remove();
    this.svg = null;
    this.nodes.clear();
    this.roots = [];
    this.order.clear();
    this.rootG = null;
    this.bg = null;
    this.anim = null;
  }

  private applyBackground(): void {
    if (!this.bg || !this.anim) return;
    const css = this.anim.background ? toCss(resolveColor(this.anim.background, this.palette)) : 'none';
    this.bg.setAttribute('fill', css);
  }

  /** (Re)attaches children to their containers sorted by z then document order. */
  private reorder(frame: Frame): void {
    const sorted = (ids: string[]) =>
      [...ids].sort((a, b) => (frame.get(a)?.z ?? 0) - (frame.get(b)?.z ?? 0) || this.order.get(a)! - this.order.get(b)!);
    for (const id of sorted(this.roots)) this.rootG!.appendChild(this.nodes.get(id)!.g);
    for (const node of this.nodes.values()) {
      if (node.children.length === 0) continue;
      for (const cid of sorted(node.children)) node.g.appendChild(this.nodes.get(cid)!.g);
    }
  }

  private apply(node: Node, a: VisualActor): void {
    const { g, shape, head } = node;
    g.setAttribute('transform', `translate(${n(a.x)} ${n(a.y)}) rotate(${n(a.rotation)}) scale(${n(a.scale)})`);
    g.setAttribute('opacity', n(a.opacity));
    g.setAttribute('visibility', a.opacity <= 0.001 ? 'hidden' : 'visible');
    if (!shape) return;

    const fill = toCss(a.fill);
    const stroke = a.strokeWidth > 0 ? toCss(a.stroke) : 'none';
    switch (node.type) {
      case 'rectangle':
        shape.setAttribute('x', n(-a.width / 2)); shape.setAttribute('y', n(-a.height / 2));
        shape.setAttribute('width', n(Math.max(0, a.width))); shape.setAttribute('height', n(Math.max(0, a.height)));
        shape.setAttribute('rx', n(Math.min(a.cornerRadius, Math.abs(a.width) / 2, Math.abs(a.height) / 2)));
        paint(shape, fill, stroke, a.strokeWidth);
        break;
      case 'circle':
        shape.setAttribute('r', n(Math.max(0, a.radius)));
        paint(shape, fill, stroke, a.strokeWidth);
        break;
      case 'ellipse':
        shape.setAttribute('rx', n(Math.max(0, a.width / 2))); shape.setAttribute('ry', n(Math.max(0, a.height / 2)));
        paint(shape, fill, stroke, a.strokeWidth);
        break;
      case 'polygon':
        shape.setAttribute('points', a.points.map((p) => `${n(p[0])},${n(p[1])}`).join(' '));
        paint(shape, fill, stroke, a.strokeWidth);
        break;
      case 'text':
        if (shape.textContent !== a.text) shape.textContent = a.text;
        shape.setAttribute('font-size', n(a.fontSize));
        shape.setAttribute('text-anchor', a.anchor);
        shape.setAttribute('fill', fill);
        break;
      case 'line':
      case 'arrow': {
        shape.setAttribute('x1', '0'); shape.setAttribute('y1', '0');
        shape.setAttribute('x2', n(a.width)); shape.setAttribute('y2', n(a.height));
        shape.setAttribute('stroke', stroke);
        shape.setAttribute('stroke-width', n(a.strokeWidth));
        if (head) {
          const len = Math.hypot(a.width, a.height);
          const size = Math.max(8, a.strokeWidth * 4);
          if (len < 1e-6 || size > len) head.setAttribute('d', '');
          else {
            const ux = a.width / len, uy = a.height / len;
            const bx = a.width - ux * size, by = a.height - uy * size;
            const px = -uy * size * 0.5, py = ux * size * 0.5;
            head.setAttribute('d', `M${n(a.width)} ${n(a.height)} L${n(bx + px)} ${n(by + py)} L${n(bx - px)} ${n(by - py)} Z`);
          }
          head.setAttribute('fill', stroke);
          head.setAttribute('stroke', stroke);
          head.setAttribute('stroke-width', '1');
        }
        break;
      }
      case 'group': break;
    }
  }
}

function paint(el: SVGElement, fill: string, stroke: string, strokeWidth: number): void {
  el.setAttribute('fill', fill);
  el.setAttribute('stroke', stroke);
  el.setAttribute('stroke-width', n(strokeWidth));
}
