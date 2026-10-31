import { h, render } from './vendor/preact.module.js';
import LandingModel from './landing-model.js';

const response = await fetch('/data/landing-template.json');
if (!response.ok) throw new Error('Landing template unavailable');
render(h(LandingModel, { template: await response.json() }), document.getElementById('app'));
