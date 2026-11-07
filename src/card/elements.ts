/**
 * Small constructors for Feishu card JSON 2.0 elements shared by the renderer
 * and the card-limit helpers. Keeping them here avoids a cycle:
 * run-renderer -> limits -> run-renderer.
 */

export function markdown(content: string): object {
  return { tag: 'markdown', content };
}

export function noteMd(content: string): object {
  return { tag: 'markdown', content, text_size: 'notation' };
}

export interface PanelOpts {
  title: string;
  expanded: boolean;
  border: 'grey' | 'red' | 'blue';
  body: string;
}

export function collapsiblePanel(opts: PanelOpts): object {
  return {
    tag: 'collapsible_panel',
    expanded: opts.expanded,
    header: panelHeader(opts.title),
    border: { color: opts.border, corner_radius: '5px' },
    vertical_spacing: '8px',
    padding: '8px 8px 8px 8px',
    elements: [{ tag: 'markdown', content: opts.body, text_size: 'notation' }],
  };
}

export function panelHeader(titleMd: string): object {
  return {
    title: { tag: 'markdown', content: titleMd },
    vertical_align: 'center',
    icon: { tag: 'standard_icon', token: 'down-small-ccm_outlined', size: '16px 16px' },
    icon_position: 'follow_text',
    icon_expanded_angle: -180,
  };
}
