const render = (markup) => `<main class="component-preview" data-theme="dark">${markup}</main>`;

export default { title: "NUSA/Components" };

export const Buttons = {
  render: () => render('<div class="ui-card"><div class="ui-card__header"><div><h2 class="ui-card__title">Actions</h2><p class="ui-card__description">Token-driven button states.</p></div></div><div class="component-preview__actions"><button class="ui-button">Continue</button><button class="ui-button ui-button--secondary">Secondary</button><button class="ui-button ui-button--ghost">Ghost</button><button class="ui-button ui-button--danger">Destructive</button></div></div>')
};

export const FormControls = {
  render: () => render('<section class="ui-card"><div class="ui-field"><label class="ui-field__label" for="quantity">Quantity</label><input class="ui-input" id="quantity" placeholder="0.001" /><p class="ui-field__hint">Use a valid decimal amount.</p></div><div class="ui-field"><label class="ui-field__label" for="scope">Scope</label><select class="ui-select" id="scope"><option>Paper only</option><option>Research</option></select></div></section>')
};

export const OperationalSurfaces = {
  render: () => render('<div class="ui-card"><span class="ui-status ui-status--healthy">Healthy</span><div class="ui-metric-card"><span class="ui-metric-card__label">Evidence coverage</span><strong class="ui-metric-card__value">94.2%</strong><span class="ui-metric-card__change">+3.1%</span></div><article class="ui-decision-card"><div class="ui-decision-card__signal">WAIT</div><div><h2 class="ui-decision-card__title">Await more evidence</h2><p class="ui-decision-card__body">No action is proposed until the confidence threshold is met.</p><div class="ui-decision-card__meta"><span class="ui-badge ui-badge--warning">Insufficient sample</span></div></div></article><div class="ui-evidence-row"><div><h3 class="ui-evidence-row__title">Walk-forward result</h3><p class="ui-evidence-row__detail">Validated from immutable experiment evidence.</p></div><strong class="ui-evidence-row__value">0.82</strong></div></div>')
};

export const States = {
  render: () => render('<div class="ui-card"><div class="ui-skeleton ui-skeleton--title" aria-label="Loading"></div><section class="ui-empty-state"><h2 class="ui-empty-state__title">No evidence yet</h2><p class="ui-empty-state__body">New research evidence will appear here after a completed run.</p></section><section class="ui-error-state" role="alert"><h2 class="ui-error-state__title">Evidence unavailable</h2><p class="ui-error-state__body">The source cannot be verified right now.</p></section></div>')
};
