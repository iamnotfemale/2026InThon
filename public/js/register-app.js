import { h, render } from './vendor/preact.module.js';
import RegisterModel from './register-model.js';

const response = await fetch('/data/register-template.json');
if (!response.ok) throw new Error('Registration template unavailable');
render(h(RegisterModel, { template: await response.json() }), document.getElementById('app'));
